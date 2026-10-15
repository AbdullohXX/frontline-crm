"use client";
import { useEffect, useRef, useState } from "react";
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
export function CallingSession({
  lead,
  boot,
}: {
  lead?: Lead;
  boot: Bootstrap;
}) {
  const [session, setSession] = useState<any>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  async function load() {
    try {
      const r = await fetch("/api/sales-calls");
      if (r.ok) {
        const d = await r.json();
        setSession(d.sessions[0]);
      }
    } catch {
      setNotice("Could not check your calling session.");
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setReady(false), [lead?.id]);
  async function run(action: string) {
    setBusy(true);
    setNotice("");
    try {
      await act({ action, lead_id: lead?.id });
      if (action === "attempt") {
        setReady(true);
        setNotice(
          "Attempt registered for 10 minutes. Call this number in Quo now.",
        );
      } else {
        setReady(false);
        await load();
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (
    boot.member.role !== "Admin" &&
    (boot.member as any).job_role !== "Sales rep"
  )
    return null;
  return (
    <details className="calling-session">
      <summary>
        Your calling session · {session ? "Active" : "Start session"}
      </summary>
      <p>
        {session
          ? `Active until ${new Date(session.expires_at).toLocaleTimeString()}`
          : "Start a session so shared-Quo calls can be credited to you."}
      </p>
      <div className="flex wrap">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(session ? "stop" : "start")}
        >
          {session ? "End session" : "Start calling session"}
        </button>
        {lead && session && (
          <button
            type="button"
            disabled={busy || !!lead.archived_at}
            onClick={() => run("attempt")}
          >
            Register call to this lead
          </button>
        )}
        {ready && (
          <a
            className="button primary"
            href={
              lead?.phone
                ? "tel:" + lead.phone.replace(/[^+\d]/g, "")
                : "quo://"
            }
          >
            Open Quo app
          </a>
        )}
      </div>
      {lead && (
        <p className="fine">
          Register before calling {lead.phone}. One registration matches at most
          one call. Calls outside the window or with competing matches remain
          unassigned.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
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
            calls.filter((c: any) => c.outcome === outcome).length;
          const humans = calls.filter((c: any) =>
            ["Spoke to person", "Meeting booked", "Qualified"].includes(
              c.outcome,
            ),
          ).length;
          return (
            <article key={m.email}>
              <h3>{m.display_name} · Sales rep</h3>
              <p>
                <strong>{calls.length}</strong> calls ·{" "}
                <strong>
                  {new Set(calls.map((c: any) => c.lead_id)).size}
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
                <select
                  aria-label={"Confirm outcome for " + c.id}
                  disabled={busy}
                  value={c.outcome || ""}
                  onChange={(e) => {
                    if (e.target.value)
                      void run({
                        action: "outcome",
                        call_id: c.id,
                        outcome: e.target.value,
                      });
                  }}
                >
                  <option value="">Confirm sales outcome…</option>
                  {outcomes.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              )}
            {!c.rep && boot.member.role === "Admin" && c.lead_id && (
              <select
                aria-label={"Assign caller for " + c.id}
                disabled={busy}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value)
                    void run({
                      action: "assign",
                      call_id: c.id,
                      rep: e.target.value,
                    });
                }}
              >
                <option value="">Admin: assign confirmed caller…</option>
                {boot.members
                  .filter((m) => m.active && m.job_role === "Sales rep")
                  .map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.display_name}
                    </option>
                  ))}
              </select>
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
