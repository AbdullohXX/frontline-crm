"use client";
import { useEffect, useRef, useState } from "react";
import type { Bootstrap, Lead } from "@/lib/types";
export default function QuoLeadTools({
  lead,
  boot,
  disabled,
  onDirty,
  onBusy,
  onSaved,
}: {
  lead: Lead;
  boot: Bootstrap;
  disabled: boolean;
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
  onSaved: (l: Lead) => void;
}) {
  const [setup, setSetup] = useState<any>(),
    [from, setFrom] = useState(""),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const request = useRef<{ id: string; fingerprint: string }>({
    id: "",
    fingerprint: "",
  });
  useEffect(() => {
    let live = true;
    fetch("/api/quo?mode=setup")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (live) {
          setSetup(d);
          setFrom(d.numbers?.find((n: any) => n.canSend)?.id || "");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [lead.id]);
  useEffect(() => onDirty(!!text), [text]);
  useEffect(() => onBusy(busy), [busy]);
  async function act(operation: string) {
    if (busy) return;
    if (
      operation === "send_sms" &&
      !window.confirm(
        `Send this SMS to ${lead.contact || lead.company} (${lead.phone})?\n\n${text}\n\nQuo API messaging charges may apply.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    const fingerprint = JSON.stringify([lead.id, from, text]);
    if (request.current.fingerprint !== fingerprint)
      request.current = { id: crypto.randomUUID(), fingerprint };
    try {
      const r = await fetch("/api/quo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation,
          lead: lead.id,
          ...(operation === "send_sms"
            ? { from, text, request_id: request.current.id }
            : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (operation === "send_sms") {
        setText("");
        setNotice("SMS submitted · " + d.status);
      } else
        setNotice(
          operation === "sync_contact"
            ? "Contact synced to Quo"
            : "Call and message history refreshed",
        );
      if (d.lead) onSaved(d.lead);
      window.dispatchEvent(new Event("quo-refreshed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!setup?.configured && !error) return null;
  return (
    <details className="quo-lead-tools">
      <summary>Quo Phone · calls & SMS</summary>
      <p>
        Place calls in{" "}
        <a href="quo://">
          Quo
        </a>
        . Calls and replies appear in this conversation automatically.
      </p>
      <div className="flex wrap">
        <button
          type="button"
          disabled={disabled || busy || boot.demo}
          onClick={() => act("sync")}
        >
          Refresh Quo history
        </button>
        <button
          type="button"
          disabled={disabled || busy || boot.demo}
          onClick={() => act("sync_contact")}
        >
          Sync contact
        </button>
      </div>
      {setup?.configured && (
        <>
          <label>
            SMS sender
            <select
              value={from}
              disabled={busy}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">Choose an assigned Quo number</option>
              {setup.numbers
                ?.filter((n: any) => n.canSend)
                .map((n: any) => (
                  <option value={n.id} key={n.id}>
                    {n.name} · {n.number}
                  </option>
                ))}
            </select>
          </label>
          {!setup.numbers?.some((n: any) => n.canSend) && (
            <p>
              An administrator must link your CRM account to a Quo user assigned
              to the number before you can send SMS.
            </p>
          )}
          <label>
            Text message
            <textarea
              value={text}
              maxLength={1600}
              disabled={busy || disabled || boot.demo}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write an SMS to this lead…"
            />
          </label>
          <div className="flex spread">
            <small>{text.length}/1600 · SMS charges may apply</small>
            <button
              type="button"
              className="purple"
              disabled={!text.trim() || !from || busy || disabled || boot.demo}
              onClick={() => act("send_sms")}
            >
              {busy ? "Working…" : "Review & send SMS"}
            </button>
          </div>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </details>
  );
}
