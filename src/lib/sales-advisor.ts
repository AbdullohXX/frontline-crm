import { z } from "zod";
export const adviceSchema = z.object({
  overview: z.string().max(1600),
  recommendations: z
    .array(
      z.object({
        title: z.string().max(120),
        category: z.enum([
          "Team strategy",
          "Rep coaching",
          "Lead priority",
          "Lead generation",
          "Data quality",
        ]),
        priority: z.enum(["High", "Medium", "Low"]),
        advice: z.string().max(1000),
        reason: z.string().max(700),
        evidence: z.array(z.string().max(180)).max(6),
      }),
    )
    .max(12),
  limitations: z.array(z.string().max(400)).max(8),
});
export function scrub(text: unknown) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email omitted]")
    .replace(/\+?\d[\d ().-]{7,}\d/g, "[phone omitted]")
    .slice(0, 2000);
}
export function advisorSnapshot(
  leads: any[],
  calls: any[],
  claims: any[],
  members: any[],
  today: string,
) {
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const claimMap = new Map(claims.map((c) => [c.call_id, c]));
  const evidence: Record<string, any> = {};
  const priority = leads
    .filter(
      (l) => !["Won", "Lost"].includes(l.stage) && l.status !== "Inactive",
    )
    .sort(
      (a, b) =>
        Number(!!b.next_follow_up && b.next_follow_up < today) -
          Number(!!a.next_follow_up && a.next_follow_up < today) ||
        Number(b.priority === "High") - Number(a.priority === "High"),
    )
    .slice(0, 25);
  for (const l of priority)
    evidence["lead:" + l.id] = {
      kind: "lead",
      id: l.id,
      lead_id: l.id,
      label: scrub(l.company),
      stage: l.stage,
      priority: l.priority,
      source: scrub(l.source),
      next_action: scrub(l.next_action),
      next_follow_up: l.next_follow_up,
      last_activity_at: l.last_activity_at,
      notes: scrub(l.notes),
      owner:
        members.find((m) => m.email === l.owner_email)?.display_name ||
        "Unknown",
    };
  for (const c of calls.slice(0, 20)) {
    const claim = claimMap.get(c.id);
    evidence["call:" + c.id] = {
      kind: "call",
      id: c.id,
      lead_id: c.lead_id,
      label: scrub(leadMap.get(c.lead_id)?.company || "Unlinked call"),
      status: c.status,
      providerAnswered: c.connected,
      duration: c.duration,
      rep: claim
        ? members.find((m) => m.email === claim.rep)?.display_name || "Unknown"
        : "Unassigned",
      outcome: claim?.outcome || "Unconfirmed",
      attribution: claim?.attribution || "Unassigned",
      at: c.occurred_at,
    };
  }
  const reps = members
    .filter((m) => m.active && m.job_role === "Sales rep")
    .map((m) => {
      const rows = calls.filter((c) => claimMap.get(c.id)?.rep === m.email);
      const outcomes: Record<string, number> = {};
      for (const c of rows) {
        const o = claimMap.get(c.id)?.outcome || "Unconfirmed";
        outcomes[o] = (outcomes[o] || 0) + 1;
      }
      return {
        name: m.display_name,
        calls: rows.length,
        uniqueLeads: new Set(rows.map((c) => c.lead_id).filter(Boolean)).size,
        providerAnswered: rows.filter((c) => c.connected).length,
        humanContacts: rows.filter((c) =>
          ["Spoke to person", "Meeting booked", "Qualified"].includes(
            claimMap.get(c.id)?.outcome,
          ),
        ).length,
        outcomes,
      };
    });
  const sources: Record<string, { leads: number; won: number; open: number }> =
    Object.create(null);
  for (const l of leads) {
    const name = scrub(l.source || "Unknown");
    const s = sources[name] || { leads: 0, won: 0, open: 0 };
    s.leads++;
    if (l.stage === "Won") s.won++;
    else if (l.stage !== "Lost") s.open++;
    sources[name] = s;
  }
  return {
    facts: {
      accessibleLeads: leads.length,
      openLeads: leads.filter((l) => !["Won", "Lost"].includes(l.stage)).length,
      overdue: leads.filter(
        (l) =>
          !["Won", "Lost"].includes(l.stage) &&
          l.next_follow_up &&
          l.next_follow_up < today,
      ).length,
      calls: calls.length,
      unassignedCalls: calls.filter((c) => !claimMap.has(c.id)).length,
      providerAnswered: calls.filter((c) => c.connected).length,
      sources,
      reps,
    },
    evidence,
  };
}
export function validateAdvice(
  output: z.infer<typeof adviceSchema>,
  evidence: Record<string, any>,
) {
  return {
    ...output,
    recommendations: output.recommendations
      .map((r) => ({
        ...r,
        evidence: r.evidence.filter((id) => Object.hasOwn(evidence, id)),
      }))
      .filter((r) => r.evidence.length > 0),
  };
}
