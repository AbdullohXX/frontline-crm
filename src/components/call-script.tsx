"use client";
import { useState } from "react";
import type { Lead } from "@/lib/types";
export default function CallScript({
  lead,
  agent,
}: {
  lead: Lead;
  agent: string;
}) {
  const [objection, setObjection] = useState("");
  const replies: Record<string, string> = {
    "No time": `I understand. Would a short email to ${lead.email || "your preferred address"} and a follow-up at a better time work?`,
    "Send an email":
      "Absolutely. What should I focus on, and when would be a good time to follow up?",
    "Not interested":
      "Understood. Is outsourcing not a priority right now, or do you already have a team covering this?",
    "No budget":
      "That makes sense. When do you next review staffing needs or budgets? We can reconnect then.",
  };
  return (
    <details className="call-script">
      <summary>Call script & objection handling</summary>
      <p>
        Hi {lead.contact || "there"}, this is {agent} from Frontline. We support
        customer service, outbound calling, appointment setting and lead
        qualification. I’m reaching out to {lead.company}
        {lead.industry ? ` in ${lead.industry}` : ""} to understand whether
        additional team capacity could help.
      </p>
      <p>Do you have two minutes to discuss your current needs?</p>
      <div className="flex wrap">
        {Object.keys(replies).map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setObjection(k)}
            aria-pressed={objection === k}
          >
            {k}
          </button>
        ))}
      </div>
      {objection && <p role="status">{replies[objection]}</p>}
      <small>
        Adapt this introduction to the conversation. Confirm the next action
        with the contact.
      </small>
    </details>
  );
}
