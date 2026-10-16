"use client";
import type { Bootstrap } from "@/lib/types";
import TrackedCall from "./tracked-call";
import { useEffect, useState } from "react";
type Contact = {
  id: string;
  name: string;
  label: string;
  email: string;
  phone: string;
  version: number;
  archived_at: string | null;
};
export default function LeadContacts({
  boot,
  lead,
  demo,
  archived,
  disabled,
  onDirty,
  onBusy,
  onSaved,
}: {
  boot: Bootstrap;
  lead: string;
  demo: boolean;
  archived: boolean;
  disabled: boolean;
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Contact[]>([]),
    [draft, setDraft] = useState<Partial<Contact> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showArchived, setShowArchived] = useState(false),
    [loading, setLoading] = useState(true);
  async function load() {
    const r = await fetch("/api/lead-contacts?lead=" + lead);
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setRows(d.contacts);
  }
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const c = new AbortController();
    fetch("/api/lead-contacts?lead=" + lead, { signal: c.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) setRows(d.contacts);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      c.abort();
    };
  }, [lead]);
  useEffect(() => {
    onDirty(!!draft);
    return () => onDirty(false);
  }, [!!draft]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy]);
  async function save(action: string, row: Partial<Contact>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/lead-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...row, lead_id: lead, action }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDraft(null);
      await load();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="additional-contacts">
      <div className="flex between">
        <h3>Additional contacts</h3>
        <button
          type="button"
          disabled={demo || archived || disabled || busy || !!draft}
          onClick={() =>
            setDraft({ name: "", label: "", email: "", phone: "" })
          }
        >
          Add contact
        </button>
      </div>
      {loading && <p role="status">Loading contacts…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {rows
        .filter((c) => showArchived || !c.archived_at)
        .map((c) => (
          <article key={c.id}>
            <strong>{c.name}</strong>
            <small>
              {c.label}
              {c.archived_at ? " · Archived" : ""}
            </small>
            {c.email && (
              <a href={"mailto:" + encodeURIComponent(c.email)}>{c.email}</a>
            )}
            {c.phone && (
              <div>
                <span>{c.phone}</span>
                <TrackedCall
                  boot={boot}
                  leadId={lead}
                  phone={c.phone}
                  disabled={archived || !!c.archived_at}
                />
              </div>
            )}
            <div className="flex wrap">
              <button
                type="button"
                disabled={demo || archived || disabled || busy || !!draft}
                onClick={() =>
                  c.archived_at ? void save("restore", c) : setDraft(c)
                }
              >
                {c.archived_at ? "Restore" : "Edit"}
              </button>
              {!c.archived_at && (
                <button
                  type="button"
                  disabled={demo || archived || disabled || busy || !!draft}
                  onClick={() => void save("archive", c)}
                >
                  Archive contact
                </button>
              )}
            </div>
          </article>
        ))}
      {!loading && !rows.length && (
        <p className="muted">
          Add labeled people or numbers here. Earlier imported notes are
          preserved in the conversation.
        </p>
      )}
      {rows.some((c) => c.archived_at) && (
        <label>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived contacts
        </label>
      )}
      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save("save", draft);
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Name
              <input
                aria-label="Additional contact name"
                required
                maxLength={200}
                value={draft.name || ""}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Role / label
              <input
                aria-label="Additional contact label"
                maxLength={100}
                value={draft.label || ""}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                aria-label="Additional contact email"
                maxLength={200}
                value={draft.email || ""}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </label>
            <label>
              International phone
              <input
                type="tel"
                aria-label="Additional contact phone"
                placeholder="+13074294109"
                pattern="\+[1-9][0-9]{6,14}"
                value={draft.phone || ""}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </label>
            <div className="flex wrap">
              <button type="submit" className="primary">
                {busy ? "Saving…" : "Save contact"}
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                Cancel contact edit
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
