"use client";
import TrackedCall from "./tracked-call";
import { STAGES, type Bootstrap, type Lead } from "@/lib/types";
import { callingInfo } from "@/lib/workflow";
import LeadContacts from "./lead-contacts";
export default function LeadSummary({
  workflowTools,
  lead,
  boot,
  onEdit,
  onActivity,
  onCopyLink,
  onContactDirty,
  onContactBusy,
  contactDisabled,
  onContactsSaved,
}: {
  workflowTools?: React.ReactNode;
  lead: Lead;
  boot: Bootstrap;
  onEdit: () => void;
  onActivity: () => void;
  onCopyLink: () => void;
  onContactDirty: (v: boolean) => void;
  onContactBusy: (v: boolean) => void;
  contactDisabled: boolean;
  onContactsSaved: () => void;
}) {
  const person = (email: string | null) =>
    boot.members.find((m) => m.email === email)?.display_name ||
    email ||
    "Not recorded";
  const call = callingInfo(lead);
  return (
    <div className="lead-summary">
      <div className="flex between wrap">
        <span className="stage-badge" data-stage={lead.stage}>
          {lead.stage}
        </span>
        <button onClick={onCopyLink}>Copy lead link</button>
      </div>
      <h3>{lead.contact || "Add a contact"}</h3>
      <p className="muted">{lead.job_title || lead.company}</p>
      <div className="contact-lines">
        {lead.email && (
          <a href={"mailto:" + encodeURIComponent(lead.email)}>{lead.email}</a>
        )}
        {lead.phone && (
          <div>
            <strong>{lead.phone}</strong>
            <TrackedCall
              boot={boot}
              leadId={lead.id}
              phone={lead.phone}
              disabled={!!lead.archived_at}
            />
          </div>
        )}
      </div>
      <p className={call.open ? "calling-open" : "muted"}>
        {call.label} {call.time} ·{" "}
        {call.open ? "Calling window open" : "Check local calling time"}
      </p>
      <div className="lead-workflow-tools">{workflowTools}</div>
      <section className="next-step-card">
        <span className="eyebrow">Next step</span>
        <h3>{lead.next_action || "Plan the next conversation"}</h3>
        <p>{lead.next_follow_up || "No follow-up scheduled"}</p>
        <button className="primary" onClick={onActivity}>
          Log activity / schedule
        </button>
      </section>
      <dl className="summary-facts">
        <div>
          <dt>Responsible owner</dt>
          <dd>{person(lead.owner_email)}</dd>
        </div>
        <div>
          <dt>Created by</dt>
          <dd>{person(lead.created_by)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{lead.source || "Not set"}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{lead.priority}</dd>
        </div>
        <div>
          <dt>Stage since</dt>
          <dd>
            {lead.stage_entered_at
              ? new Date(lead.stage_entered_at).toLocaleDateString(undefined, {
                  timeZone: boot.timeZone,
                })
              : "Historical date unknown"}
          </dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>
            {lead.last_activity_at
              ? new Date(lead.last_activity_at).toLocaleString(undefined, {
                  timeZone: boot.timeZone,
                })
              : "Not recorded"}
          </dd>
        </div>
      </dl>
      <details>
        <summary>Opportunity details</summary>
        <dl className="summary-facts">
          <div>
            <dt>Value</dt>
            <dd>
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(lead.value)}
            </dd>
          </div>
          <div>
            <dt>Country / region</dt>
            <dd>{lead.country || "Not set"}</dd>
          </div>
          <div>
            <dt>Industry</dt>
            <dd>{lead.industry || "Not set"}</dd>
          </div>
          <div>
            <dt>Work category</dt>
            <dd>{lead.work_status || "None"}</dd>
          </div>
          <div>
            <dt>Lead ID</dt>
            <dd>{lead.legacy_id || lead.id}</dd>
          </div>
        </dl>
      </details>
      <ol className="stage-progress" aria-label="Pipeline stages">
        {STAGES.map((s) => (
          <li
            key={s}
            aria-current={s === lead.stage ? "step" : undefined}
            data-current={s === lead.stage}
          >
            {s}
          </li>
        ))}
      </ol>
      <button onClick={onEdit}>Edit lead details</button>
      <LeadContacts
        boot={boot}
        lead={lead.id}
        demo={boot.demo}
        archived={!!lead.archived_at}
        disabled={contactDisabled}
        onDirty={onContactDirty}
        onBusy={onContactBusy}
        onSaved={onContactsSaved}
      />
    </div>
  );
}
