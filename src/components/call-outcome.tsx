"use client";
import { useEffect, useState } from "react";
const outcomes = [
  "Spoke to person",
  "Voicemail",
  "No answer",
  "Wrong number",
  "Number disconnected",
  "Follow-up required",
  "Meeting booked",
  "Qualified",
];
export default function CallOutcome({
  id,
  onSaved,
}: {
  id: string;
  onSaved: () => void;
}) {
  const [data, setData] = useState<any>(),
    [outcome, setOutcome] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/sales-calls?call=" + encodeURIComponent(id), {
      signal: c.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => {
        setData(d);
        setOutcome(d.claim?.outcome || "");
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError(
            "Attribution is unavailable. Retry from Analytics → Activity & team.",
          );
      });
    return () => c.abort();
  }, [id]);
  return (
    <div className="call-confirmation">
      <strong>Confirmed sales outcome</strong>
      {!data && !error && <p role="status">Checking attribution…</p>}
      {data &&
        (data.canConfirm ? (
          <div className="flex wrap">
            <select
              aria-label="Confirm this call outcome"
              value={outcome}
              disabled={busy}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="">Choose the actual outcome</option>
              {outcomes.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !outcome}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await fetch("/api/sales-calls", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "outcome",
                      call_id: id,
                      outcome,
                    }),
                  });
                  const d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  window.dispatchEvent(new Event("quo-refreshed"));
                  onSaved();
                  setError("Outcome saved.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Confirm outcome"}
            </button>
          </div>
        ) : (
          <p>
            {data.claim
              ? "Only the attributed rep or an administrator can confirm this call."
              : "Caller unassigned. An administrator must review attribution in Analytics → Activity & team."}
          </p>
        ))}
      {error && <p role="status">{error}</p>}
    </div>
  );
}
