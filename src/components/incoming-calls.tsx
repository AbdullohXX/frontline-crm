"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IncomingCall } from "@/lib/incoming-call";
import { isLiveIncomingCall } from "@/lib/incoming-call";

export default function IncomingCalls({
  enabled,
  blocked,
  locked,
  dialog,
  onOpen,
}: {
  enabled: boolean;
  blocked: boolean;
  locked: boolean;
  dialog: HTMLDialogElement | null;
  onOpen: (id: string, replace?: boolean) => Promise<void>;
}) {
  const seen = useRef(new Set<string>());
  const [pending, setPending] = useState<IncomingCall | null>(null);
  const current = useRef({ blocked, onOpen, pending });
  current.current = { blocked, onOpen, pending };
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    try {
      for (const id of JSON.parse(
        sessionStorage.getItem("quo-seen-calls") || "[]",
      ))
        seen.current.add(id);
    } catch {}
    async function poll() {
      {
        try {
          const res = await fetch("/api/quo/incoming", {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!res.ok) throw Error("Incoming call updates unavailable");
          const { calls } = (await res.json()) as { calls: IncomingCall[] };
          if (stopped) return;
          setOffline(false);
          setPending((old) =>
            old && calls.some((c) => c.id === old.id) ? old : null,
          );
          const fresh = calls.filter(
            (c) => isLiveIncomingCall(c) && !seen.current.has(c.id),
          );
          const call = current.current.pending ? undefined : fresh[0];
          if (call) seen.current.add(call.id);
          try {
            sessionStorage.setItem(
              "quo-seen-calls",
              JSON.stringify([...seen.current].slice(-200)),
            );
          } catch {}
          if (call) {
            setError("");
            if (call.lead_id && !current.current.blocked) {
              try {
                await current.current.onOpen(call.lead_id);
              } catch {
                if (!stopped) {
                  setPending(call);
                  setError("Could not open profile. Try again.");
                }
              }
            } else setPending(call);
          }
        } catch {
          if (!stopped) setOffline(true);
        }
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled]);

  if (!enabled || (!pending && !offline)) return null;
  const target = dialog?.open
    ? dialog
    : typeof document !== "undefined"
      ? document.body
      : null;
  if (!target) return null;
  return createPortal(
    <aside role="status" className="incoming-call-alert">
      {pending ? (
        <>
          <strong>Incoming Quo call · +{pending.phone || "unknown"}</strong>
          <p>
            {pending.lead_id
              ? "Caller matched a CRM lead. Your current work is preserved."
              : "No unique active lead match. Search the caller’s number to review."}
          </p>
          {pending.lead_id && (
            <button
              disabled={opening || locked}
              onClick={async () => {
                if (
                  current.current.blocked &&
                  !window.confirm(
                    "Open the caller profile? Unsaved work in this lead window will be discarded.",
                  )
                )
                  return;
                setOpening(true);
                try {
                  await current.current.onOpen(pending.lead_id!, true);
                  setPending(null);
                } catch {
                  setError("Could not open profile. Try again.");
                } finally {
                  setOpening(false);
                }
              }}
            >
              {opening ? "Opening…" : "Open caller profile"}
            </button>
          )}
          <button onClick={() => setPending(null)}>Dismiss</button>
          {error && <p role="alert">{error}</p>}
        </>
      ) : (
        <small>Incoming call updates unavailable. Reconnecting…</small>
      )}
    </aside>,
    target,
  );
}
