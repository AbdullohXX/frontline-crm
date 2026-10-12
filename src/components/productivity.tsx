"use client";
import { useEffect, useRef, useState } from "react";
import type { Bootstrap } from "@/lib/types";
import type { AdvancedReport } from "@/lib/analytics";
export function ActiveUsage({ demo }: { demo: boolean }) {
  const interaction = useRef(0);
  useEffect(() => {
    if (demo) return;
    const touch = () => {
      interaction.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      if (!document.hidden && Date.now() - interaction.current < 60000)
        void fetch("/api/productivity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "presence" }),
        });
    }, 60000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [demo]);
  return null;
}
export default function Productivity({
  boot,
  report,
  from,
  to,
}: {
  boot: Bootstrap;
  report: AdvancedReport;
  from: string;
  to: string;
}) {
  const [daily, setDaily] = useState<AdvancedReport | null>(null);
  const [data, setData] = useState<any>({
    targets: [],
    presence: [],
    usage: [],
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const r = await fetch("/api/productivity");
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
      const today = await fetch(
        "/api/analytics?" +
          new URLSearchParams({ from: boot.today, to: boot.today }),
      );
      if (today.ok) setDaily(await today.json());
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60000);
    return () => clearInterval(t);
  }, []);
  async function action(path: string, p: unknown = {}) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(
        d.ok
          ? "Goals saved."
          : d.message ||
              `Completed: ${d.imported ?? d.inserted ?? 0} records added.`,
      );
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const usage = (email: string) =>
    data.usage
      .filter(
        (u: any) =>
          u.email === email && (!from || u.day >= from) && (!to || u.day <= to),
      )
      .reduce((sum: number, u: any) => sum + u.minutes, 0);
  const rank = (key: "emails" | "wins" | "calls") =>
    [...report.agents]
      .filter((a) => Number((a as any)[key] || 0) > 0)
      .sort(
        (a, b) => Number((b as any)[key] || 0) - Number((a as any)[key] || 0),
      )[0];
  return (
    <section className="productivity-panel">
      <h2>Team productivity</h2>
      <p className="muted">
        Results for the selected dates · goals are daily · active time counts
        recent interaction in a visible tab, starting from this release (latest
        90 days).
      </p>
      <div className="flex wrap">
        <a className="button" href="/auth/gmail">
          Connect my Gmail
        </a>
        <button disabled={busy} onClick={() => action("/api/gmail/sync")}>
          Sync my sent emails
        </button>
      </div>
      <p className="fine">
        Gmail imports subject, recipients and sent time only.
      </p>
      {message && <p role="status">{message}</p>}
      <div className="productivity-grid">
        {[
          ["Most calls", rank("calls")?.label],
          ["Most emails", rank("emails")?.label],
          ["Top closer", rank("wins")?.label],
          [
            "Most active time",
            boot.members
              .filter((m) => usage(m.email) > 0)
              .sort((a, b) => usage(b.email) - usage(a.email))[0]?.display_name,
          ],
        ].map(([title, name]) => (
          <article key={title}>
            <small>{title} · selected period</small>
            <h3>{name || "No activity yet"}</h3>
          </article>
        ))}
      </div>
      <div className="productivity-grid">
        {boot.members
          .filter((m) => m.active)
          .map((m) => {
            const a = report.agents.find((a) => a.email === m.email);
            const today = daily?.agents.find((a) => a.email === m.email);
            const t = data.targets.find((t: any) => t.email === m.email) || {
              calls: 50,
              emails: 20,
            };
            const online = data.presence.some(
              (p: any) =>
                p.email === m.email &&
                Date.now() - Date.parse(p.last_seen) < 120000,
            );
            return (
              <article key={m.email}>
                <h3>
                  {m.display_name}{" "}
                  <small>{online ? "Active now" : "Away"}</small>
                </h3>
                <p>
                  {a?.calls || 0} calls · {(a as any)?.emails || 0} emails ·{" "}
                  {a?.wins || 0} won · {a?.overdue || 0} overdue
                </p>
                <p>
                  {(usage(m.email) / 60).toFixed(1)} active hours ·{" "}
                  {a?.leads || 0} assigned
                </p>
                <p>
                  Today: {today?.calls || 0} / {t.calls} calls
                </p>
                <progress
                  aria-label={`Daily calls for ${m.display_name}`}
                  max={t.calls}
                  value={today?.calls || 0}
                />
                <p>
                  Today: {today?.emails || 0} / {t.emails} emails
                </p>
                <progress
                  aria-label={`Daily emails for ${m.display_name}`}
                  max={t.emails}
                  value={today?.emails || 0}
                />
                <details>
                  <summary>Recent activity</summary>
                  {a?.recent.map((event) => (
                    <p key={event.id}>
                      <strong>{event.action}</strong> ·{" "}
                      {event.details.slice(0, 180)}
                      <small>
                        {" "}
                        ·{" "}
                        {new Date(event.at).toLocaleString(undefined, {
                          timeZone: boot.timeZone,
                        })}
                      </small>
                    </p>
                  ))}
                </details>
                {boot.member.role === "Admin" && (
                  <form
                    className="target-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void action("/api/productivity", {
                        action: "targets",
                        email: m.email,
                        calls: Number(f.get("calls")),
                        emails: Number(f.get("emails")),
                      });
                    }}
                  >
                    <label>
                      Calls/day
                      <input
                        key={`c${t.calls}`}
                        name="calls"
                        type="number"
                        min="1"
                        max="10000"
                        defaultValue={t.calls}
                        required
                      />
                    </label>
                    <label>
                      Emails/day
                      <input
                        key={`e${t.emails}`}
                        name="emails"
                        type="number"
                        min="1"
                        max="10000"
                        defaultValue={t.emails}
                        required
                      />
                    </label>
                    <button disabled={busy}>Save goals</button>
                  </form>
                )}
              </article>
            );
          })}
      </div>
    </section>
  );
}
