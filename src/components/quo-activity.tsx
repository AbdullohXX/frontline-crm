"use client";
import { useEffect, useState } from "react";
import { mergeQuoDetails } from "@/lib/quo-details";
export default function QuoActivity({ event }: { event: any }) {
  const [details, setDetails] = useState<any>(event.payload || {}),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setDetails((previous: any) => mergeQuoDetails(previous, event.payload || {}));
  }, [event.payload]);
  async function load() {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        "/api/quo/recording?" +
          new URLSearchParams({ call: event.id, mode: "details" }),
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDetails((previous: any) => mergeQuoDetails(previous, d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (event.kind !== "call")
    return (
      <small className="quo-origin">
        Quo SMS · {event.direction} · {event.status}
        {event.payload?.hasMedia ? " · Media available in Quo" : ""}
      </small>
    );
  const summary = details.summary?.summary || [];
  return (
    <div className="quo-call-detail">
      <small className="quo-origin">
        Quo · {event.direction || "Call"} · {event.duration}s ·{" "}
        {event.connected ? "Connected (may include voicemail)" : event.status}
      </small>
      <button
        type="button"
        disabled={busy}
        onClick={() => (open ? setOpen(false) : load())}
      >
        {busy
          ? "Loading call details…"
          : open
            ? "Hide call details"
            : "Recordings, transcript & summary"}
      </button>
      {open && (
        <div className="quo-artifacts">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {(details.recordings || [])
            .filter((r: any) => r.id)
            .map((r: any) => (
              <div key={r.id}>
                <strong>Call recording · {r.duration || 0}s</strong>
                <audio
                  controls
                  preload="none"
                  src={
                    r.url ||
                    "/api/quo/recording?" +
                      new URLSearchParams({ call: event.id, recording: r.id })
                  }
                />
              </div>
            ))}
          {!busy && !error && !details.recordings?.length && (
            <p>No recording available yet. Recording must be enabled in Quo.</p>
          )}
          {!!summary.length && (
            <>
              <strong>Quo AI summary</strong>
              <ul>
                {summary.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {!!details.summary?.nextSteps?.length && (
            <>
              <strong>Suggested next steps</strong>
              <ul>
                {details.summary.nextSteps.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {details.voicemail && (
            <>
              <strong>Voicemail</strong>
              <audio
                controls
                preload="none"
                src={
                  "/api/quo/recording?" +
                  new URLSearchParams({ call: event.id, voicemail: "true" })
                }
              />
              <p>{details.voicemail.transcript}</p>
            </>
          )}
          {details.transcriptError && <p>{details.transcriptError}</p>}
          {(details.transcripts || [])
            .filter((t: any) => t.status === "completed")
            .map((t: any, i: number) => (
              <details key={t.recordingId || i}>
                <summary>Call transcript</summary>
                {(t.dialogue || []).map((line: any, j: number) => (
                  <p key={j}>
                    <strong>
                      {Math.floor(line.start || 0)}s ·{" "}
                      {line.actorId || line.userId
                        ? "Team member"
                        : line.identifier || "Speaker"}
                      :{" "}
                    </strong>
                    {line.content}
                  </p>
                ))}
              </details>
            ))}
          {!busy && !error && !summary.length && (
            <p>
              Summaries and transcripts depend on Quo plan and processing
              availability.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
