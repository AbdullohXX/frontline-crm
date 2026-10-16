"use client";
import { useEffect, useState } from "react";
import type { Bootstrap, Lead } from "@/lib/types";
export default function LeadInsight({
  lead,
  boot,
}: {
  lead: Lead;
  boot: Bootstrap;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [cursor, setCursor] = useState<string | null>(null);
  async function load() {
    const r = await fetch("/api/lead-insight?lead=" + lead.id);
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    let alive = true;
    const c = new AbortController();
    setData(undefined);
    setError("");
    setNotice("");
    setCursor(null);
    fetch("/api/lead-insight?lead=" + lead.id, { signal: c.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    const refresh = () => void load().catch((e) => setError(e.message));
    window.addEventListener("quo-refreshed", refresh);
    window.addEventListener("gmail-refreshed", refresh);
    return () => {
      alive = false;
      c.abort();
      window.removeEventListener("quo-refreshed", refresh);
      window.removeEventListener("gmail-refreshed", refresh);
    };
  }, [lead.id, lead.version]);
  async function sync(older = false) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/gmail/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(older && cursor ? { page_token: cursor } : {}),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setCursor(d.nextPageToken || null);
      setNotice(d.message);
      await load();
      window.dispatchEvent(new Event("gmail-refreshed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (boot.member.role !== "Admin" && boot.member.job_role !== "Sales rep")
    return null;
  const date = (s: string) =>
    new Date(s).toLocaleString(undefined, { timeZone: boot.timeZone });
  return (
    <section className="lead-insight-card">
      <span className="eyebrow">What to do now</span>
      {!data && !error && <p>Checking verified outreach…</p>}
      {data && (
        <>
          <h3>{data.insight.title}</h3>
          <p>{data.insight.detail}</p>
          <small>{data.period} · Your outreach</small>
          <ul className="outreach-checklist">
            <li data-done={!!data.call}>
              <strong>
                {data.call
                  ? "✓ Call attempt recorded"
                  : "○ Call not yet verified"}
              </strong>
              {data.call && (
                <small>
                  {date(data.call.occurred_at)} ·{" "}
                  {data.call.disposition ||
                    data.call.outcome ||
                    "Outcome needs confirmation"}
                </small>
              )}
            </li>
            <li data-done={!!data.email}>
              <strong>
                {data.email ? "✓ Email verified sent" : "○ Email not yet found"}
              </strong>
              {data.email && (
                <small>
                  {data.email.sender} → {data.email.recipient}
                  <br />
                  {date(data.email.sent_at)}
                </small>
              )}
            </li>
          </ul>
          <div className="flex wrap">
            {data.recipient && (
              <a
                className="button"
                href={"mailto:" + encodeURIComponent(data.recipient)}
              >
                Write email
              </a>
            )}
            <a className="button" href="/auth/gmail">
              {data.mailboxConnected ? "Reconnect Gmail" : "Connect my Gmail"}
            </a>
            <button
              type="button"
              disabled={busy || boot.demo}
              onClick={() => void sync()}
            >
              {busy ? "Checking…" : "Check my sent emails"}
            </button>
            {cursor && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void sync(true)}
              >
                Check older sent emails
              </button>
            )}
          </div>
          <small>
            Verified against Gmail Sent metadata. No email body is read. Manual
            email activities do not complete this checklist.
          </small>
          {data.emails.length > 0 && (
            <details>
              <summary>Recent verified team emails</summary>
              {data.emails.slice(0, 10).map((e: any, i: number) => (
                <p key={i}>
                  {boot.members.find((m) => m.email === e.sender)
                    ?.display_name || e.sender}{" "}
                  → {e.recipient}
                  <br />
                  {date(e.sent_at)} · {e.subject || "(No subject)"}
                </p>
              ))}
            </details>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
