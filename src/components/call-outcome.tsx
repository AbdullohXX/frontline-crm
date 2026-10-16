"use client";
import { useEffect, useState } from "react";
const dispositions = [
  "Spoke to person",
  "Voicemail",
  "No answer",
  "Wrong number",
  "Number disconnected",
];
export default function CallOutcome({
  id,
  onSaved,
}: {
  id: string;
  onSaved: () => void;
}) {
  const [data, setData] = useState<any>(),
    [disposition, setDisposition] = useState(""),
    [result, setResult] = useState(""),
    [next, setNext] = useState(""),
    [date, setDate] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setData(undefined);
    setError("");
    fetch("/api/sales-calls?call=" + encodeURIComponent(id), {
      signal: c.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        return d;
      })
      .then((d) => {
        setData(d);
        setDisposition(
          d.claim?.disposition ||
            (dispositions.includes(d.claim?.outcome) ? d.claim.outcome : ""),
        );
        setResult(
          ["Follow-up required", "Meeting booked", "Qualified"].includes(
            d.claim?.outcome,
          )
            ? d.claim.outcome
            : "",
        );
        setNext(d.lead?.next_action || "");
        setDate(d.lead?.next_follow_up || "");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/sales-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "outcome",
          call_id: id,
          disposition,
          outcome: result || disposition,
          version: data.lead?.version,
          next_action: next,
          next_follow_up: date,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData({ ...data, lead: d.lead });
      window.dispatchEvent(new Event("quo-refreshed"));
      onSaved();
      setError("Outcome saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="call-confirmation">
      <strong>Confirm call and next step</strong>
      {!data && !error && <p>Checking attribution…</p>}
      {data &&
        (data.canConfirm ? (
          <form onSubmit={save} className="form-grid">
            <label>
              Connection
              <select
                required
                value={disposition}
                disabled={busy}
                onChange={(e) => {
                  setDisposition(e.target.value);
                  if (
                    e.target.value !== "Spoke to person" &&
                    result !== "Follow-up required"
                  )
                    setResult("");
                }}
              >
                <option value="">What actually happened?</option>
                {dispositions.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Sales result
              <select
                value={result}
                disabled={busy}
                onChange={(e) => setResult(e.target.value)}
              >
                <option value="">No stage change</option>
                <option>Follow-up required</option>
                {disposition === "Spoke to person" && (
                  <>
                    <option>Meeting booked</option>
                    <option>Qualified</option>
                  </>
                )}
              </select>
            </label>
            <label>
              Next action
              <input
                value={next}
                maxLength={300}
                required={!!date || result === "Follow-up required"}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <label>
              Follow-up date
              <input
                type="date"
                value={date}
                required={!!next || result === "Follow-up required"}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <small>
              Meeting booked and Qualified update the lead stage. Clear both
              follow-up fields to remove a scheduled follow-up.
            </small>
            <button disabled={busy || !disposition}>
              {busy ? "Saving…" : "Save outcome & next step"}
            </button>
          </form>
        ) : (
          <p>
            {data.claim
              ? "Only the attributed rep or administrator can confirm this call."
              : "Caller unassigned. An administrator must verify attribution in Analytics."}
          </p>
        ))}
      {error && <p role="status">{error}</p>}
    </div>
  );
}
