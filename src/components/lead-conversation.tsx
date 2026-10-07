"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Paperclip, Send, RefreshCw, X, MessageSquare } from "lucide-react";
import { browserDatabase } from "@/lib/supabase/client";
import type { Lead, Bootstrap, Activity } from "@/lib/types";
type Attachment = {
  id: string;
  name: string;
  mime: string;
  url: string;
  size: number;
};
type Event = Activity & {
  attachments: Attachment[];
  snapshot?: { before?: Lead; after?: Lead };
};
export default function LeadConversation({
  lead,
  boot,
  disabled,
  onSaved,
  onDraftChange,
  onBusyChange,
}: {
  lead: Lead;
  boot: Bootstrap;
  disabled: boolean;
  onSaved: (lead: Lead) => void;
  onDraftChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [events, setEvents] = useState<Event[]>([]),
    [text, setText] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false);
  const list = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    sending = useRef(false),
    lastFetch = useRef(0),
    lastCount = useRef(0),
    nearBottom = useRef(true),
    alive = useRef(true);
  useEffect(() => {
    onDraftChange(!!text || files.length > 0);
  }, [text, files.length]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy]);
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: boot.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  async function load(older = false) {
    const token = ++lastFetch.current;
    try {
      const oldest = [...events].sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      )[0];
      const q = new URLSearchParams({ lead: lead.id });
      if (older && oldest) {
        q.set("before", oldest.created_at);
        q.set("beforeId", oldest.id);
      }
      const response = await fetch("/api/conversation?" + q, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Conversation unavailable.");
      if (!alive.current || token !== lastFetch.current) return;
      setEvents((previous) => {
        const map = new Map(previous.map((e) => [e.id, e]));
        data.events.forEach((e: Event) => map.set(e.id, e));
        return [...map.values()].sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        );
      });
      if (older || !events.length) setMore(data.hasMore);
      setError("");
    } catch (e) {
      if (alive.current && token === lastFetch.current)
        setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden && !sending.current) void load();
    }, 30000);
    return () => {
      alive.current = false;
      lastFetch.current++;
      clearInterval(timer);
    };
  }, [lead.id]);
  useEffect(() => {
    if (events.length !== lastCount.current && nearBottom.current)
      list.current?.scrollTo({
        top: list.current.scrollHeight,
        behavior: "smooth",
      });
    lastCount.current = events.length;
  }, [events]);
  function selectFiles(chosen: File[]) {
    const all = [...files, ...chosen];
    if (all.length > 4) {
      setError("Attach up to four files per message.");
      return;
    }
    const accepted = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/ogg",
      "audio/mp4",
      "audio/webm",
    ];
    for (const f of all) {
      if (!accepted.includes(f.type)) {
        setError("Use JPG, PNG, WebP, GIF, MP3, WAV, OGG, M4A or WebM audio.");
        return;
      }
      if (
        !f.size ||
        f.size > (f.type.startsWith("image/") ? 8388608 : 26214400)
      ) {
        setError("Images: up to 8 MB. Recordings: up to 25 MB.");
        return;
      }
    }
    setFiles(all);
    setError("");
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (sending.current || disabled || boot.demo) return;
    setBusy(true);
    sending.current = true;
    setError("");
    const paths: string[] = [];
    let posted = false;
    try {
      const db = browserDatabase();
      const attachments = [];
      for (const f of files) {
        const extension = (
          {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/gif": "gif",
            "audio/mpeg": "mp3",
            "audio/wav": "wav",
            "audio/x-wav": "wav",
            "audio/ogg": "ogg",
            "audio/mp4": "m4a",
            "audio/webm": "webm",
          } as Record<string, string>
        )[f.type];
        const path = lead.id + "/" + crypto.randomUUID() + "." + extension;
        const { error } = await db.storage
          .from("lead-media")
          .upload(path, f, { contentType: f.type, upsert: false });
        if (error) throw Error("Upload failed: " + error.message);
        paths.push(path);
        attachments.push({
          path,
          name: f.name.slice(0, 200),
          mime: f.type,
          size: f.size,
        });
      }
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, message: text, attachments }),
      });
      const saved = await response.json();
      if (!response.ok) throw Error(saved.error || "Could not post message.");
      posted = true;
      if (alive.current) {
        setText("");
        setFiles([]);
        if (fileInput.current) fileInput.current.value = "";
        onSaved(saved);
        nearBottom.current = true;
        await load();
      }
    } catch (e) {
      if (!posted && paths.length) {
        try {
          await browserDatabase().storage.from("lead-media").remove(paths);
        } catch {
          /* Unlinked uploads stay private. */
        }
      }
      if (alive.current) setError((e as Error).message);
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const creator =
    boot.members.find((m) => m.email === lead.created_by)?.display_name ||
    lead.created_by;
  return (
    <section className="lead-conversation" aria-label="Lead conversation">
      <header className="conversation-head">
        <div>
          <h3>
            <MessageSquare size={18} /> Conversation & history
          </h3>
          <p>Shared with the team · Times in {boot.timeZone}</p>
        </div>
        <button
          type="button"
          aria-label="Refresh lead conversation"
          disabled={busy}
          onClick={() => load()}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      <div
        className="chat-log"
        ref={list}
        role="log"
        aria-label="Lead messages"
        onScroll={() => {
          const node = list.current!;
          nearBottom.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 100;
        }}
      >
        {more && (
          <button
            type="button"
            className="chat-older"
            onClick={() => {
              nearBottom.current = false;
              void load(true);
            }}
          >
            Load earlier history
          </button>
        )}
        <article className="chat-system">
          <strong>{lead.legacy_id ? "Imported lead" : "Lead created"}</strong>
          <p>
            {lead.legacy_id
              ? "Original creator: " + (creator || "not recorded")
              : "Created by " + (creator || "Unknown creator")}
          </p>
          <time>
            {lead.legacy_id
              ? "Original date: " +
                (lead.original_created_date || "not recorded")
              : date(lead.created_at)}
          </time>
        </article>
        {lead.notes && (
          <article className="chat-legacy">
            <strong>Existing lead notes</strong>
            <small>
              Earlier notes · original author and posting time may not be
              recorded
            </small>
            <p>{lead.notes}</p>
          </article>
        )}
        {loading && <p role="status">Loading conversation…</p>}
        {events.map((event) => {
          const mine = event.actor_email === boot.member.email;
          const note = event.action === "Note";
          const changed =
            event.snapshot?.before && event.snapshot?.after
              ? Object.keys(event.snapshot.after).filter(
                  (k) =>
                    !["version", "updated_at", "last_activity_at"].includes(
                      k,
                    ) &&
                    JSON.stringify((event.snapshot!.before as any)[k]) !==
                      JSON.stringify((event.snapshot!.after as any)[k]),
                )
              : [];
          return (
            <article
              key={event.id}
              className={
                "chat-message " +
                (mine ? "mine " : "") +
                (note ? "" : "chat-event")
              }
            >
              <div className="chat-author">
                <span className="chat-avatar">
                  {event.actor_name.slice(0, 2).toUpperCase()}
                </span>
                <strong>
                  {event.actor_name}
                  {mine ? " · You" : ""}
                </strong>
                <time dateTime={event.created_at}>
                  {date(event.created_at)}
                </time>
              </div>
              <div className="chat-bubble">
                {!note && (
                  <strong className="chat-event-title">
                    {event.action}
                    {event.outcome ? " · " + event.outcome : ""}
                  </strong>
                )}
                {event.details && <p>{event.details}</p>}
                {event.from_stage &&
                  event.to_stage &&
                  event.from_stage !== event.to_stage && (
                    <p>
                      {event.from_stage} → {event.to_stage}
                    </p>
                  )}
                {changed.length > 0 && (
                  <small>
                    Changed:{" "}
                    {changed.map((s) => s.replaceAll("_", " ")).join(", ")}
                  </small>
                )}
                {event.next_action && (
                  <p>
                    Next: {event.next_action} · {event.next_follow_up}
                  </p>
                )}
                {event.attachments.map((file) => (
                  <div className="chat-attachment" key={file.id}>
                    {file.url ? (
                      file.mime.startsWith("image/") ? (
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <img src={file.url} alt={file.name} loading="lazy" />
                        </a>
                      ) : (
                        <>
                          <strong>Call recording · uploaded</strong>
                          <audio controls preload="none" src={file.url}>
                            Your browser does not support audio playback.
                          </audio>
                        </>
                      )
                    ) : (
                      <p>Media unavailable. Refresh this conversation.</p>
                    )}
                    <span>
                      {file.name} · {(file.size / 1048576).toFixed(1)} MB
                    </span>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
        {!loading && !events.length && (
          <p className="empty">
            Start the conversation. Notes and uploads show who posted them and
            when.
          </p>
        )}
      </div>
      <form className="chat-composer" onSubmit={send}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {(disabled || lead.archived_at || boot.demo) && (
          <p className="fine">
            {boot.demo
              ? "Preview is read-only."
              : lead.archived_at
                ? "Restore this lead before posting."
                : "Save or cancel your lead edits before posting a message."}
          </p>
        )}
        {files.length > 0 && (
          <div className="chat-pending">
            {files.map((f, i) => (
              <span key={i}>
                {f.name}
                <button
                  type="button"
                  aria-label={"Remove " + f.name}
                  disabled={busy}
                  onClick={() =>
                    setFiles((all) => all.filter((_, j) => j !== i))
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          aria-label="Write a lead message"
          placeholder="Write a note for the team…"
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy || disabled || !!lead.archived_at || boot.demo}
        />
        <div className="chat-compose-actions">
          <label className="button">
            <Paperclip size={16} /> Images / recording
            <input
              ref={fileInput}
              aria-label="Attach images or call recordings"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/webm"
              disabled={busy || disabled || !!lead.archived_at || boot.demo}
              onChange={(e) => {
                selectFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="purple"
            disabled={
              busy ||
              disabled ||
              !!lead.archived_at ||
              boot.demo ||
              (!text.trim() && !files.length)
            }
          >
            <Send size={15} />
            {busy ? "Posting…" : "Send"}
          </button>
        </div>
        <small>
          Images ≤8 MB · recordings ≤25 MB · Getyn recordings must be uploaded
          manually.
        </small>
      </form>
    </section>
  );
}
