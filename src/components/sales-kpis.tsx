"use client";
import { useEffect, useRef, useState } from "react";
import CallOutcome from "./call-outcome";
import type { Bootstrap, Lead } from "@/lib/types";
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
async function act(p: unknown) {
  const r = await fetch("/api/sales-calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
}
export function CallingSession({ boot }: { lead?: Lead; boot: Bootstrap }) {
  const [data, setData] = useState<any>({ sessions: [], attempts: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const eligible =
    boot.member.active &&
    (boot.member.role === "Admin" || boot.member.job_role === "Sales rep");
  useEffect(() => {
    if (!eligible || boot.demo) return;
    let alive = true;
    const c = new AbortController();
    async function load() {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/sales-calls?mode=session", {
          signal: c.signal,
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    void load();
    const t = setInterval(load, 30000);
    window.addEventListener("calling-session-changed", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      c.abort();
      clearInterval(t);
      window.removeEventListener("calling-session-changed", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [eligible, boot.demo]);
  if (!eligible) return null;
  async function run(p: unknown) {
    setBusy(true);
    try {
      await act(p);
      if ((p as any).action === "cancel")
        window.dispatchEvent(new Event("calling-attempt-cancelled"));
      window.dispatchEvent(new Event("calling-session-changed"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="calling-session">
      <summary>
        Your calling session · {data.sessions.length ? "Active" : "Ready"}
      </summary>
      <p>
        Use Call in Quo to register a call before opening the desktop app.
        Unmatched calls stay unassigned.
      </p>
      {data.sessions.length > 0 && (
        <button disabled={busy} onClick={() => void run({ action: "stop" })}>
          End session
        </button>
      )}
      {data.attempts.map((a: any) => (
        <div key={a.id}>
          <span>Pending call · {a.phone}</span>
          <button
            disabled={busy}
            onClick={() => void run({ action: "cancel", attempt_id: a.id })}
          >
            Cancel unused attempt
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export default function SalesKpis({
  boot,
  period,
}: {
  boot: Bootstrap;
  period?: { from: string; to: string };
}) {
  const [from, setFrom] = useState(boot.today),
    [to, setTo] = useState(boot.today),
    [data, setData] = useState<any>({
      calls: [],
      generators: [],
      attempts: [],
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (period) {
      setFrom(period.from || "1900-01-01");
      setTo(period.to || boot.today);
    }
  }, [period?.from, period?.to, boot.today]);
  const sequence = useRef(0);
  async function load() {
    const requestId = ++sequence.current;
    try {
      const r = await fetch(
        "/api/sales-calls?" + new URLSearchParams({ from, to }),
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (requestId !== sequence.current) return;
      setData(d);
      setError("");
    } catch (e) {
      if (requestId === sequence.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [from, to]);
  async function run(p: unknown) {
    setBusy(true);
    try {
      await act(p);
      await load();
      window.dispatchEvent(new Event("quo-refreshed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [selectedUser, setSelectedUser] = useState("");
  const reps = boot.members.filter(
    (m) =>
      (m as any).job_role === "Sales rep" &&
      m.email === selectedUser &&
      m.active,
  );
  const generators = boot.members.filter(
    (m) =>
      (m as any).job_role === "Lead generator" &&
      m.email === selectedUser &&
      m.active,
  );
  const unassigned = data.calls.filter((c: any) => !c.rep);
  return (
    <section className="productivity-panel">
      <h2>Team performance</h2>
      <label>
        Team member
        <select
          value={selectedUser}
          onChange={(e) => setSelectedUser(e.target.value)}
        >
          <option value="">Select a team member…</option>
          {boot.members
            .filter((m) => m.active && m.job_role !== "Other" && m.job_role)
            .map((m) => (
              <option key={m.email} value={m.email}>
                {m.display_name} · {m.job_role}
              </option>
            ))}
        </select>
      </label>
      {!selectedUser && (
        <p className="muted">
          Choose a team member to see their role-specific performance.
        </p>
      )}
      <p className="muted">
        Shared Quo account · credit comes from CRM call registrations or admin
        review. Answered includes voicemail; human contact requires rep
        confirmation.
      </p>
      <div className="flex wrap" hidden={!!period}>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {[
          ["Today", 0],
          ["Last 7 days", 6],
          ["Last 30 days", 29],
        ].map(([label, n]) => (
          <button
            key={label}
            onClick={() => {
              setTo(boot.today);
              setFrom(
                new Date(Date.parse(boot.today) - Number(n) * 86400000)
                  .toISOString()
                  .slice(0, 10),
              );
            }}
          >
            {label}
          </button>
        ))}
        <button onClick={load}>Refresh calls</button>
      </div>
      <p className="fine">
        Date boundaries: {data.timeZone || "UTC"}. Calls arrive through Quo
        sync. Registrations are not counted as completed calls.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data.limitReached && (
        <p role="alert">
          This range reached the reporting limit. Select a smaller range before
          using these counts.
        </p>
      )}
      <div className="productivity-grid">
        {reps.map((m) => {
          const calls = data.calls.filter((c: any) => c.rep === m.email);
          const count = (outcome: string) =>
            calls.filter(
              (c: any) =>
                (c.disposition && outcomes.indexOf(outcome) < 5
                  ? c.disposition
                  : c.outcome) === outcome,
            ).length;
          const humans = calls.filter((c: any) =>
            c.disposition
              ? c.disposition === "Spoke to person"
              : ["Spoke to person", "Meeting booked", "Qualified"].includes(
                  c.outcome,
                ),
          ).length;
          return (
            <article key={m.email}>
              <h3>{m.display_name} · Sales rep</h3>
              <p>
                <strong>{calls.length}</strong> calls ·{" "}
                <strong>
                  {
                    new Set(
                      calls
                        .filter((c: any) => c.lead_id)
                        .map((c: any) => c.lead_id),
                    ).size
                  }
                </strong>{" "}
                unique leads
              </p>
              <p>
                {calls.filter((c: any) => c.connected).length} provider-answered
                ·{" "}
                {
                  calls.filter(
                    (c: any) =>
                      !c.connected &&
                      [
                        "completed",
                        "missed",
                        "failed",
                        "no-answer",
                        "busy",
                        "canceled",
                      ].includes(c.status),
                  ).length
                }{" "}
                provider-unanswered
              </p>
              <p>
                {humans} human connections ·{" "}
                {calls.length ? Math.round((humans / calls.length) * 100) : 0}%
                human connection rate
              </p>
              {outcomes.map((o) => (
                <small className="kpi-outcome" key={o}>
                  {o}: {count(o)}
                </small>
              ))}
              <p>
                {calls.filter((c: any) => !c.outcome).length} awaiting outcome
                confirmation
              </p>
            </article>
          );
        })}
      </div>
      {generators.length > 0 && <h3>Lead generation</h3>}
      <div className="productivity-grid">
        {generators.map((m) => {
          const leads = data.generators.filter(
            (l: any) => l.created_by === m.email,
          );
          return (
            <article key={m.email}>
              <h3>{m.display_name}</h3>
              <p>
                {leads.length} leads created ·{" "}
                {leads.filter((l: any) => l.phone || l.email).length} with
                contact details
              </p>
              <p>
                {
                  leads.filter((l: any) =>
                    [
                      "Qualified",
                      "Meeting Booked",
                      "Proposal",
                      "Negotiation",
                      "Won",
                    ].includes(l.stage),
                  ).length
                }{" "}
                currently qualified or further ·{" "}
                {leads.filter((l: any) => l.stage === "Won").length} currently
                won
              </p>
            </article>
          );
        })}
      </div>
      <p className="fine">
        Creator attribution starts with recorded CRM creators; imported leads
        without a known creator are not guessed.
      </p>
      <section className="panel">
        <h3>Data coverage</h3>
        <p>
          {data.calls.length} provider calls ·{" "}
          {data.calls.filter((c: any) => c.lead_id).length} linked to leads ·{" "}
          {data.calls.filter((c: any) => c.rep).length} attributed to a rep ·{" "}
          {data.calls.filter((c: any) => c.outcome).length} confirmed outcomes
        </p>
        <p>
          {data.generators.filter((l: any) => !l.created_by).length} leads in
          this period have no recorded creator. They are excluded from
          individual generator credit.
        </p>
      </section>
      <h3>Call outcomes & unassigned review ({unassigned.length})</h3>
      <div className="sales-call-list">
        {data.calls.map((c: any) => (
          <article key={c.id}>
            <strong>
              {c.phone} ·{" "}
              {boot.members.find((m) => m.email === c.rep)?.display_name ||
                "Unassigned"}
            </strong>
            <p>
              {new Date(c.occurred_at).toLocaleString()} · Quo: {c.status} ·{" "}
              {c.connected
                ? "Answered (may be voicemail)"
                : "Not answered / unfinished"}{" "}
              · {c.duration}s
            </p>
            {c.rep ? (
              <p>
                {c.attribution} · {c.outcome || "Outcome not confirmed"}
              </p>
            ) : (
              <p>Call has no unique registered rep. Admin review required.</p>
            )}
            {c.rep &&
              (c.rep === boot.member.email || boot.member.role === "Admin") && (
                <details>
                  <summary>Confirm outcome</summary>
                  <CallOutcome id={c.id} onSaved={() => void load()} />
                </details>
              )}
            {boot.member.role === "Admin" && c.lead_id && (
              <details>
                <summary>{c.rep ? "Correct caller" : "Assign caller"}</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run({
                      action: "assign",
                      call_id: c.id,
                      rep: f.get("rep"),
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <select name="rep" required defaultValue={c.rep || ""}>
                    <option value="">Choose verified caller</option>
                    {boot.members
                      .filter((m) => m.active && m.job_role === "Sales rep")
                      .map((m) => (
                        <option key={m.email} value={m.email}>
                          {m.display_name}
                        </option>
                      ))}
                  </select>
                  <input
                    name="reason"
                    required
                    minLength={5}
                    maxLength={500}
                    placeholder="Evidence for this attribution"
                    aria-label="Attribution evidence"
                  />
                  <p className="fine">
                    Changing attribution clears the previous confirmed outcome.
                  </p>
                  <button disabled={busy}>Save attribution</button>
                </form>
              </details>
            )}
            {!c.lead_id && (
              <small>
                Link this call to a lead in the Quo call review before
                assigning.
              </small>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
