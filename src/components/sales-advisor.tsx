"use client";
import { useEffect, useState } from "react";
export default function SalesAdvisor({
  from,
  to,
  owner,
  source,
  onLead,
}: {
  from: string;
  to: string;
  owner: string;
  source: string;
  onLead: (id: string) => void;
}) {
  const [report, setReport] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/sales-advisor")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.report) setReport(d.report);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  async function analyze() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/sales-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, owner, source }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setReport(d.report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="productivity-panel sales-advisor">
      <div className="flex between wrap">
        <div>
          <h2>AI sales advisor</h2>
          <p className="muted">
            Review the pipeline, Quo conversations and sales outcomes together.
          </p>
        </div>
        <button
          className="primary"
          disabled={busy || !from || !to}
          onClick={analyze}
        >
          {busy ? "Analyzing sales…" : "Analyze sales"}
        </button>
      </div>
      <p className="fine">
        Uses the Analytics date, owner and source filters. Sends approved CRM
        note and call excerpts to Vercel AI Gateway; direct phone/email details
        are omitted. Recommendations never change records or contact leads. Up
        to three runs per hour.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <a
            href="https://vercel.com/abdulloxs-team/~/ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            AI Gateway settings
          </a>
        </p>
      )}
      {busy && (
        <p role="status">
          Collecting permitted CRM records and available Quo
          summaries/transcripts. This can take a minute.
        </p>
      )}
      {report && (
        <>
          <div className="advisor-coverage">
            <strong>
              Analysis from {new Date(report.generatedAt).toLocaleString()}
            </strong>
            <p>
              {report.coverage.from}–{report.coverage.to} ·{" "}
              {report.coverage.dateBoundaries} · {report.coverage.leadMetadata}{" "}
              leads · {report.coverage.callMetadata} calls ·{" "}
              {report.coverage.summariesAvailable} summary samples ·{" "}
              {report.coverage.transcriptsAvailable} transcript samples
            </p>
            <p className="fine">
              {report.coverage.owner
                ? "Owner-filtered"
                : "All accessible owners"}{" "}
              · {report.coverage.source || "All sources"} · Current pipeline
              metadata plus calls in the date range. Text is sampled, not a
              review of every recording.
            </p>
          </div>
          <p>{report.overview}</p>
          <div className="productivity-grid">
            {report.recommendations.map((r: any, i: number) => (
              <article key={i}>
                <small>
                  {r.category} · {r.priority} priority
                </small>
                <h3>{r.title}</h3>
                <p>{r.advice}</p>
                <p className="muted">{r.reason}</p>
                <div className="flex wrap">
                  {r.evidence.map((id: string) => {
                    const e = report.evidence[id];
                    return e?.lead_id ? (
                      <button key={id} onClick={() => onLead(e.lead_id)}>
                        {e.kind === "call" ? "Call" : "Lead"} · {e.label}
                      </button>
                    ) : (
                      <small key={id}>{e?.label || id}</small>
                    );
                  })}
                </div>
                <details>
                  <summary>Supporting evidence</summary>
                  {r.evidence.map((id: string) => {
                    const e = report.evidence[id];
                    return (
                      <div key={id}>
                        <strong>
                          {e?.label} · {e?.id}
                        </strong>
                        <p>
                          {e?.kind === "call"
                            ? `${e.rep} · ${e.status} · ${e.outcome}`
                            : `${e?.stage} · ${e?.next_action}`}
                        </p>
                        {e?.summary && <p>{e.summary}</p>}
                      </div>
                    );
                  })}
                </details>
              </article>
            ))}
          </div>
          {!report.recommendations.length && (
            <p>
              No recommendations with valid lead/call evidence were produced.
              Try a wider date range.
            </p>
          )}
          <details>
            <summary>Limitations and missing data</summary>
            <ul>
              {report.limitations.map((l: string, i: number) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            <p>
              Shared-account attribution can be uncertain. Provider answers
              include voicemail. Historical imported creators and stage timing
              may be missing. Advice is a hypothesis to review, not a guaranteed
              sales improvement.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
