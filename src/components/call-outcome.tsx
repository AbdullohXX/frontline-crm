"use client";
import { STAGES } from "@/lib/types";
import { nextFollowup } from "@/lib/call-suggestion";
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
  const [stage, setStage] = useState(""),
    [loss, setLoss] = useState(""),
    [data, setData] = useState<any>(),
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
        setStage("");
        setLoss("");
        if (!d.claim?.outcome && d.canConfirm) {
          const s = d.suggestion;
          setDisposition(s.disposition || "");
          setStage(s.stage || (d.lead?.stage === "New" ? "Contacted" : ""));
          if (s.stage) {
            setNext(s.next_action);
            setDate(s.next_follow_up);
            setLoss(s.loss_reason);
            setResult(
              s.next_follow_up
                ? "Follow-up required"
                : s.stage === "Meeting Booked"
                  ? "Meeting booked"
                  : "",
            );
          }
        }
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
          stage:
            stage || (data.lead?.stage === "New" ? "Contacted" : undefined),
          loss_reason: loss || undefined,
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
            <details className="call-suggestion">
              <summary>Suggested next step · {data.suggestion?.source}</summary>
              <p>{data.suggestion?.reason}</p>
              {data.suggestion?.stage && (
                <p>
                  Stage: {data.suggestion.stage}{" "}
                  {data.suggestion.next_follow_up
                    ? " · " + data.suggestion.next_follow_up
                    : ""}
                </p>
              )}
              <details>
                <summary>Review source summary</summary>
                {data.suggestion?.evidence?.map((line: string, i: number) => (
                  <p key={i}>{line}</p>
                ))}
              </details>
              <button
                type="button"
                onClick={() => {
                  const s = data.suggestion;
                  if (s.disposition) setDisposition(s.disposition);
                  setStage(s.stage);
                  setNext(s.next_action);
                  setDate(s.next_follow_up);
                  setLoss(s.loss_reason);
                  setResult(
                    s.next_follow_up
                      ? "Follow-up required"
                      : s.stage === "Meeting Booked"
                        ? "Meeting booked"
                        : "",
                  );
                }}
              >
                Use suggestion in draft
              </button>
              <small>Nothing changes until you confirm below.</small>
            </details>
            <label>
              Pipeline stage
              <select
                value={stage}
                onChange={(e) => {
                  const v = e.target.value;
                  setStage(v);
                  if (v.startsWith("Follow-up")) {
                    setDate(data.tomorrow);
                    setNext("Follow up with contact");
                    setResult("Follow-up required");
                  }
                }}
              >
                <option value="">Keep current stage</option>
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {stage === "Lost" && (
              <label>
                Loss reason
                <input
                  required
                  maxLength={500}
                  value={loss}
                  onChange={(e) => setLoss(e.target.value)}
                />
              </label>
            )}
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
                onChange={(e) => {
                  const v = e.target.value;
                  setResult(v);
                  if (v === "Follow-up required") {
                    setStage(nextFollowup(data.lead?.stage || "New"));
                    setDate(data.tomorrow);
                    setNext("Follow up with contact");
                  } else if (v === "Meeting booked") setStage("Meeting Booked");
                }}
              >
                <option value="">No stage change</option>
                <option>Follow-up required</option>
                {disposition === "Spoke to person" && (
                  <>
                    <option>Meeting booked</option>
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
              Choose the stage and review the suggested next step. Follow-ups
              default to tomorrow; choose another date if needed. Clear both
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
