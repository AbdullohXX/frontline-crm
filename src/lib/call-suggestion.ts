export function tomorrowInZone(zone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (s: string) => parts.find((p) => p.type === s)!.value;
  const d = new Date(
    part("year") + "-" + part("month") + "-" + part("day") + "T12:00:00Z",
  );
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export function nextFollowup(stage: string) {
  return stage === "Follow-up 1"
    ? "Follow-up 2"
    : ["Follow-up 2", "Follow-up 3"].includes(stage)
      ? "Follow-up 3"
      : "Follow-up 1";
}
export function suggestCall(event: any, stage: string, tomorrow: string) {
  const summary = event.payload?.summary;
  const lines = [
    ...(Array.isArray(summary?.summary) ? summary.summary : []),
    ...(Array.isArray(summary?.nextSteps) ? summary.nextSteps : []),
  ]
    .filter((s: unknown) => typeof s === "string")
    .slice(0, 30);
  const evidence = lines.join(" ");
  const text = evidence.toLowerCase();
  let disposition = "",
    target = "",
    reason = "",
    follow = false;
  if (
    /wrong (?:phone )?number|number (?:is |was )?(?:disconnected|does not exist|invalid)/.test(
      text,
    )
  ) {
    disposition = /wrong/.test(text) ? "Wrong number" : "Number disconnected";
    target = "Lost";
    reason =
      "Quo summary reports an invalid contact number. Review before closing.";
  } else if (
    /not interested|declined (?:the |our )?(?:offer|services|proposal)|do not (?:call|contact)|no longer interested/.test(
      text,
    )
  ) {
    disposition = "Spoke to person";
    target = "Lost";
    reason = "Quo summary reports rejection. Review before closing.";
  } else if (
    /(?:meeting|appointment|demo).{0,35}(?:booked|scheduled|confirmed)|(?:booked|scheduled|confirmed).{0,35}(?:meeting|appointment|demo)/.test(
      text,
    )
  ) {
    disposition = "Spoke to person";
    target = "Meeting Booked";
    reason = "Quo summary mentions a booked meeting.";
  } else if (/voicemail|answering machine/.test(text)) {
    disposition = "Voicemail";
    follow = true;
    reason = "Quo summary mentions voicemail.";
  } else if (
    /no answer|did not answer|unanswered/.test(text) ||
    ["missed", "no-answer", "busy", "failed", "canceled"].includes(event.status)
  ) {
    disposition = "No answer";
    follow = true;
    reason =
      "No answer reported; confirm whether another attempt is appropriate.";
  } else if (
    /follow.?up|call (?:back|again)|send (?:an? |the |more )?(?:email|information|proposal|details)|next steps/.test(
      text,
    )
  ) {
    follow = true;
    reason =
      "Quo summary includes a next step; confirm the actual connection outcome.";
  }
  if (follow) {
    target = stage === "Follow-up 3" ? "Follow-up 3" : nextFollowup(stage);
    if (stage === "Follow-up 3")
      reason +=
        " Three follow-ups reached: review whether to close or book a meeting.";
  }
  return {
    disposition,
    stage: target,
    next_action: follow ? "Follow up with contact" : "",
    next_follow_up: follow ? tomorrow : "",
    loss_reason:
      target === "Lost"
        ? lines
            .find((s: string) =>
              /wrong|disconnected|invalid|interested|declined|do not/.test(
                s.toLowerCase(),
              ),
            )
            ?.slice(0, 500) || reason
        : "",
    reason:
      reason ||
      "No clear outcome in the available summary. Rep review required.",
    evidence: lines,
    source: lines.length ? "Quo AI summary" : "Provider status",
    requires_confirmation: true,
  };
}
