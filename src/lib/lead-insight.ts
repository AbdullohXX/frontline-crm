import type { Lead } from "./types";
export function outreachInsight(
  lead: Lead,
  today: string,
  called: boolean,
  emailed: boolean,
) {
  if (lead.archived_at)
    return {
      title: "Archived lead",
      detail: "Restore it before planning further outreach.",
      tone: "quiet",
    };
  if (lead.stage === "Won")
    return {
      title: "Prepare the handover",
      detail:
        "Confirm onboarding, ownership and the customer’s agreed next steps.",
      tone: "complete",
    };
  if (lead.stage === "Lost")
    return {
      title: "Review the loss reason",
      detail:
        lead.loss_reason ||
        "Keep a clear loss reason before considering future reactivation.",
      tone: "quiet",
    };
  if (lead.stage === "Meeting Booked")
    return {
      title: "Prepare for the meeting",
      detail:
        "Confirm the meeting time, participants and agenda. Review the last call summary.",
      tone: "meeting",
    };
  if (lead.stage === "Negotiation")
    return {
      title: "Resolve the next decision",
      detail:
        lead.next_action ||
        "Clarify objections, decision makers and the agreed commercial next step.",
      tone: "meeting",
    };
  if (lead.next_follow_up && lead.next_follow_up > today)
    return {
      title: "Follow up on " + lead.next_follow_up,
      detail:
        lead.next_action ||
        "Review the history and prepare the next call and email. Outreach is not due yet.",
      tone: "scheduled",
    };
  if ((!lead.phone && !called) || (!lead.email && !emailed))
    return {
      title:
        !lead.phone && !lead.email
          ? "Find contact details"
          : !lead.email
            ? "Add a contact email"
            : "Add a phone number",
      detail:
        "Open People & contacts and add the missing details so both call and email outreach are possible.",
      tone: "action",
    };
  if (!called && !emailed)
    return {
      title: "Call and email this lead",
      detail:
        "Use the tracked Quo button, then send a personal email from your company mailbox. Verify the sent email here.",
      tone: "action",
    };
  if (!called)
    return {
      title: "Make the call",
      detail:
        "Email is verified. Place the tracked call and confirm its real outcome.",
      tone: "action",
    };
  if (!emailed)
    return {
      title: "Send and verify the email",
      detail:
        "The call attempt is recorded. Send the follow-up email, then check Gmail. Missing evidence does not prove no email was sent.",
      tone: "action",
    };
  return {
    title: "Review the outcome and plan the next move",
    detail:
      lead.stage === "Follow-up 3"
        ? "Both channels are recorded. Review whether to book a meeting, negotiate or close the lead with a reason."
        : "Both channels are recorded. Confirm the call outcome, then book a meeting or schedule the next follow-up.",
    tone: "complete",
  };
}
