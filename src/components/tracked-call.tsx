"use client";
import { useEffect, useState } from "react";
import type { Bootstrap } from "@/lib/types";
import { can } from "@/lib/capabilities";
export default function TrackedCall({
  leadId,
  phone,
  boot,
  disabled = false,
}: {
  leadId: string;
  phone: string;
  boot: Bootstrap;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState<{
      phone: string;
      id: string;
      expires: string;
    } | null>(null);
  useEffect(() => {
    setReady(null);
    setError("");
  }, [leadId, phone]);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(
      () => {
        setReady(null);
        setError("Call registration expired. Prepare a new call.");
      },
      Math.max(0, Date.parse(ready.expires) - Date.now()),
    );
    const cleared = () => {
      setReady(null);
    };
    window.addEventListener("calling-attempt-cancelled", cleared);
    return () => {
      clearTimeout(t);
      window.removeEventListener("calling-attempt-cancelled", cleared);
    };
  }, [ready]);
  if (!can(boot.member, "sales")) return null;
  async function action(cancel = false) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/sales-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          cancel
            ? { action: "cancel", attempt_id: ready?.id }
            : { action: "launch", lead_id: leadId, phone },
        ),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setReady(
        cancel
          ? null
          : { phone: d.phone, id: d.attempt, expires: d.expires_at },
      );
      window.dispatchEvent(new Event("calling-session-changed"));
      if (!cancel) window.location.assign("tel:" + d.phone);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="tracked-call">
      {!ready && (
        <button
          type="button"
          disabled={busy || disabled || boot.demo || !phone}
          onClick={() => void action()}
        >
          {busy ? "Preparing…" : "Call in Quo"}
        </button>
      )}
      {ready && (
        <>
          <a
            className="button primary"
            title="Registered to you. Open the Quo desktop app."
            href={"tel:" + ready.phone}
          >
            Open Quo
          </a>
          <button
            type="button"
            disabled={busy}
            aria-label="Cancel unused call attempt"
            title="Cancel this attempt if no call was made"
            onClick={() => void action(true)}
          >
            ×
          </button>
        </>
      )}
      {error && (
        <span className="call-inline-error" role="alert" title={error}>
          {error.includes("awaiting Quo")
            ? "Another call is pending"
            : "Could not prepare call"}
          <button
            type="button"
            aria-label="Dismiss call message"
            onClick={() => setError("")}
          >
            ×
          </button>
        </span>
      )}
    </span>
  );
}
