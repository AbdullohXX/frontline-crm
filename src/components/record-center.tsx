"use client";
import { type ReactNode } from "react";
import type { Bootstrap, Lead } from "@/lib/types";
import LeadInsight from "./lead-insight";
export default function RecordCenter({
  lead,
  boot,
  overview,
  busy,
  tab,
  setTab,
  children,
}: {
  lead: Lead;
  boot: Bootstrap;
  overview: boolean;
  busy: boolean;
  tab: "catchup" | "activities";
  setTab: (tab: "catchup" | "activities") => void;
  children: ReactNode;
}) {
  return (
    <section className="record-center" aria-label="Lead workspace">
      {overview && (
        <div className="record-center-tabs" aria-label="Record view">
          <button
            aria-pressed={tab === "catchup"}
            disabled={busy}
            onClick={() => setTab("catchup")}
          >
            Catch-up
          </button>
          <button
            aria-pressed={tab === "activities"}
            disabled={busy}
            onClick={() => setTab("activities")}
          >
            Activities
          </button>
        </div>
      )}
      {overview && (
        <div hidden={tab !== "catchup"} className="record-catchup">
          <div className="record-section-heading">
            <span className="eyebrow">LEAD OVERVIEW</span>
            <h2>Your next conversation, in context.</h2>
            <p className="muted">
              Outreach checks and next steps for {lead.company}.
            </p>
          </div>
          <LeadInsight lead={lead} boot={boot} />
          <section className="record-context-card">
            <h3>Next planned step</h3>
            <p>{lead.next_action || "No next action recorded yet."}</p>
            <p className="muted">
              {lead.next_follow_up
                ? "Follow-up: " + lead.next_follow_up
                : "No follow-up scheduled"}
            </p>
            <button onClick={() => setTab("activities")}>
              Open conversation & log activity →
            </button>
          </section>
          <section className="record-context-card">
            <h3>Recent activity</h3>
            <p>
              {lead.last_activity_at
                ? new Date(lead.last_activity_at).toLocaleString(undefined, {
                    timeZone: boot.timeZone,
                  })
                : "No activity recorded"}
            </p>
            <p className="muted">
              Open Activities for the full timeline, Quo calls, notes and email
              history.
            </p>
          </section>
        </div>
      )}
      <div
        hidden={overview && tab !== "activities"}
        className="record-activity-panel"
      >
        {children}
      </div>
    </section>
  );
}
