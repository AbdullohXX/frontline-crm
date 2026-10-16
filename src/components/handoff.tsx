"use client";
import { useState } from "react";
import type { Bootstrap, Lead } from "@/lib/types";
export default function Handoff({
  boot,
  lead,
  onSaved,
}: {
  boot: Bootstrap;
  lead: Lead;
  onSaved: (l: Lead) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const admin = boot.member.role === "Admin";
  const submit =
    admin ||
    (boot.member.job_role === "Lead generator" &&
      (lead.created_by === boot.member.email ||
        lead.owner_email === boot.member.email) &&
      !["Pending", "Accepted"].includes(lead.handoff_status || ""));
  const receive =
    (admin || lead.sales_assignee === boot.member.email) &&
    lead.handoff_status === "Pending";
  async function run(action: string, f: FormData) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          lead_id: lead.id,
          version: lead.version,
          rep: f.get("rep") || undefined,
          note: f.get("note") || "",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      onSaved(d.lead);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="calling-session" key={lead.id}>
      <summary>
        Sales handoff · {lead.handoff_status || "Not submitted"}
        {lead.sales_assignee
          ? " · " +
            (boot.members.find((m) => m.email === lead.sales_assignee)
              ?.display_name || lead.sales_assignee)
          : ""}
      </summary>
      {lead.handoff_note && <p>{lead.handoff_note}</p>}
      {!lead.archived_at && (submit || receive) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const button = (e.nativeEvent as SubmitEvent)
              .submitter as HTMLButtonElement | null;
            void run(
              button?.value || (submit ? "submit" : "accept"),
              new FormData(e.currentTarget),
            );
          }}
        >
          {submit && (
            <select
              name="rep"
              aria-label="Sales representative"
              defaultValue={lead.sales_assignee || ""}
            >
              <option value="">Choose sales rep</option>
              {boot.members
                .filter((m) => m.active && m.job_role === "Sales rep")
                .map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.display_name}
                  </option>
                ))}
            </select>
          )}
          <input
            name="note"
            aria-label="Handoff note"
            maxLength={1000}
            placeholder="Context for sales / reason for return"
          />
          {submit && (
            <button disabled={busy || boot.demo} value="submit">
              Hand to sales
            </button>
          )}
          {receive && (
            <>
              <button disabled={busy || boot.demo} value="accept">
                Accept lead
              </button>
              <button disabled={busy || boot.demo} value="return">
                Return with reason
              </button>
            </>
          )}
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
