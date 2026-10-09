"use client";
import { useEffect, useRef, useState } from "react";
import type { Bootstrap } from "@/lib/types";
import QuoActivity from "./quo-activity";
export function QuoAnalytics({ boot }: { boot: Bootstrap }) {
  const [start, setStart] = useState(
      new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    ),
    [end, setEnd] = useState(boot.today),
    [actor, setActor] = useState(""),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(
      "/api/quo?" + new URLSearchParams({ mode: "report", start, end, actor }),
      { signal: controller.signal },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [start, end, actor]);
  const bars = (rows: any[], color: string) => (
    <div className="quo-bars">
      {rows.map((s: any) => (
        <div key={s.label}>
          <span>{s.label}</span>
          <div>
            <i
              style={{
                width:
                  (100 * s.value) / Math.max(1, ...rows.map((r) => r.value)) +
                  "%",
                background: color,
              }}
            />
          </div>
          <strong>{s.value}</strong>
        </div>
      ))}
      {!rows.length && <p>No Quo activity in this period.</p>}
    </div>
  );
  const named = (rows: any[]) =>
    (rows || []).map((r) => ({
      ...r,
      label: data.users?.find((u: any) => u.id === r.label)?.name || r.label,
    }));
  return (
    <section className="panel quo-analytics">
      <header className="panel-head">
        <div>
          <h3>Quo communication analytics</h3>
          <p>
            Actual provider calls and SMS · Daily chart in America/New_York ·
            Connected calls can include voicemail pickup.
          </p>
        </div>
      </header>
      <div className="quo-filters">
        <label>
          From
          <input
            type="date"
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label>
          Quo user
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">All users</option>
            {data?.users?.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data?.calls !== undefined && (
        <>
          <div className="quo-kpis">
            {[
              ["Calls", data.calls],
              [
                "Connected rate",
                data.terminal
                  ? Math.round((data.answered / data.terminal) * 100) + "%"
                  : "—",
              ],
              ["Missed incoming", data.missed],
              ["Talk time", Math.round(data.seconds / 60) + " min"],
              ["Average connected", Math.round(data.average) + " sec"],
              ["SMS", data.messages],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="quo-charts">
            <section>
              <h4>Calls by day</h4>
              {bars(data.daily, "#68cbb3")}
            </section>
            <section>
              <h4>Calls by Quo user</h4>
              {bars(named(data.agents), "#a879ff")}
            </section>
            <section>
              <h4>Call outcomes</h4>
              {bars(data.statuses, "#f1b45b")}
            </section>
            <section>
              <h4>Incoming vs outgoing</h4>
              {bars(data.directions, "#718af0")}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
export default function QuoDashboard({ boot }: { boot: Bootstrap }) {
  const [setup, setSetup] = useState<any>(),
    [events, setEvents] = useState<any[]>([]),
    [more, setMore] = useState(false),
    [unmatched, setUnmatched] = useState(false),
    [kind, setKind] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [linkId, setLinkId] = useState(""),
    [search, setSearch] = useState(""),
    [choices, setChoices] = useState<any[]>([]),
    [target, setTarget] = useState("");
  const fetchToken = useRef(0);
  async function load(older = false) {
    const token = ++fetchToken.current;
    setError("");
    try {
      const q = new URLSearchParams({ unmatched: String(unmatched) });
      if (kind) q.set("kind", kind);
      const last = events.at(-1);
      if (older && last) {
        q.set("before", last.occurred_at);
        q.set("beforeId", last.id);
      }
      const r = await fetch("/api/quo?" + q);
      const d = await r.json();
      if (token !== fetchToken.current) return;
      if (!r.ok) throw Error(d.error);
      setEvents((old) =>
        older
          ? [...new Map([...old, ...d.events].map((e) => [e.id, e])).values()]
          : d.events,
      );
      setMore(d.hasMore);
    } catch (e) {
      if (token === fetchToken.current) setError((e as Error).message);
    }
  }
  async function loadSetup() {
    const r = await fetch("/api/quo?mode=setup");
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setSetup(d);
  }
  useEffect(() => {
    loadSetup().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    void load();
    return () => {
      fetchToken.current++;
    };
  }, [unmatched, kind]);
  useEffect(() => {
    if (!linkId) return;
    const c = new AbortController(),
      timer = setTimeout(
        () =>
          fetch("/api/leads?" + new URLSearchParams({ search, scope: "all" }), {
            signal: c.signal,
          })
            .then((r) => r.json())
            .then((d) => setChoices(d.leads || []))
            .catch(() => {}),
        250,
      );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [search, linkId]);
  async function act(p: any) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/quo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setNotice(
        p.operation === "sync"
          ? `${d.calls} calls and ${d.messages} messages refreshed`
          : "Mapping saved",
      );
      setLinkId("");
      await loadSetup();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quo-workspace">
      <section className="panel">
        <header className="panel-head">
          <div>
            <h3>Quo Phone</h3>
            <p>Calls, recordings and messages connected to the CRM.</p>
          </div>
          <a
            className="button purple"
            href="https://my.quo.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Quo to call
          </a>
        </header>
        <div className="quo-filters">
          <span className="pill">
            {setup?.configured ? "API connected" : "Not connected"}
          </span>
          <span className="pill">
            {setup?.webhookReady
              ? "Live webhooks configured"
              : "Webhooks need configuration"}
          </span>
          {setup?.lastSync && (
            <small>
              Last sync: {new Date(setup.lastSync).toLocaleString()}
            </small>
          )}
          {setup?.pendingContacts > 0 && (
            <small>{setup.pendingContacts} contacts queued</small>
          )}
          {boot.member.role === "Admin" && (
            <button
              disabled={busy || boot.demo}
              onClick={() => act({ operation: "sync" })}
            >
              {busy ? "Syncing…" : "Sync last 30 days"}
            </button>
          )}
        </div>
        <p className="quo-note">
          Calls run in Quo’s app. This connection imports activity; it does not
          embed a browser softphone. SMS is sent only when you review and submit
          a message in a lead.
        </p>
        {setup?.numbers?.map((n: any) => (
          <div className="quo-number" key={n.id}>
            <strong>{n.name}</strong>
            <span>{n.number}</span>
          </div>
        ))}
      </section>
      {boot.member.role === "Admin" && (
        <details className="panel quo-admin">
          <summary>Quo user mapping</summary>
          <p>
            Link each Quo user to their CRM account. Only users assigned to a
            Quo number can send from it.
          </p>
          {setup?.users?.map((u: any) => (
            <div className="quo-mapping" key={u.id}>
              <span>
                <strong>{u.name}</strong>
                <small>{u.email}</small>
              </span>
              <select
                value={mapping[u.id] ?? u.member_email ?? ""}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, [u.id]: e.target.value }))
                }
              >
                <option value="">Choose a CRM member</option>
                {boot.members
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.display_name} · {m.email}
                    </option>
                  ))}
              </select>
              <button
                disabled={
                  busy || boot.demo || !(mapping[u.id] || u.member_email)
                }
                onClick={() =>
                  act({
                    operation: "map_user",
                    id: u.id,
                    email: mapping[u.id] || u.member_email,
                  })
                }
              >
                Save mapping
              </button>
            </div>
          ))}
        </details>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="panel">
        <header className="panel-head">
          <h3>Communication history</h3>
          <div className="flex wrap">
            <select
              aria-label="Activity type"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">Calls & SMS</option>
              <option value="call">Calls</option>
              <option value="message">SMS</option>
            </select>
            {boot.member.role === "Admin" && (
              <label>
                <input
                  type="checkbox"
                  checked={unmatched}
                  onChange={(e) => setUnmatched(e.target.checked)}
                />{" "}
                Unmatched only
              </label>
            )}
            <button onClick={() => load()}>Refresh</button>
          </div>
        </header>
        {!events.length && (
          <p className="empty">
            No activity in this view. Unmatched numbers require administrator
            review.
          </p>
        )}
        {events.map((e) => (
          <article className="quo-history" key={e.id}>
            <div className="flex spread">
              <strong>
                {e.kind === "call" ? "Call" : "SMS"} ·{" "}
                {e.phone ? "+" + e.phone : "Unresolved participant"}
              </strong>
              <time>{new Date(e.occurred_at).toLocaleString()}</time>
            </div>
            <p>
              {setup?.users?.find((u: any) => u.id === e.user_id)?.name ||
                "Unmapped Quo user"}{" "}
              · {e.direction} · {e.status}
            </p>
            {e.content && <p className="quo-message-text">{e.content}</p>}
            <QuoActivity event={e} />
            {!e.lead_id && boot.member.role === "Admin" && (
              <button
                onClick={() => {
                  setLinkId(e.id);
                  setTarget("");
                }}
              >
                Link to a lead
              </button>
            )}
            {linkId === e.id && (
              <div className="quo-link">
                <input
                  placeholder="Find company, contact or phone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose the matching lead</option>
                  {choices.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.company} · {l.contact} · {l.phone}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!target || busy}
                  onClick={() =>
                    act({ operation: "link", id: e.id, lead: target })
                  }
                >
                  Link history
                </button>
                <button onClick={() => setLinkId("")}>Cancel</button>
              </div>
            )}
          </article>
        ))}
        {more && (
          <button className="quo-load-more" onClick={() => load(true)}>
            Load older activity
          </button>
        )}
      </section>
    </div>
  );
}
