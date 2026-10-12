import type { Lead, Activity, Bootstrap } from "./types";
import { STAGES } from "./types";
const today = new Date().toISOString().slice(0, 10);
const names = [
  "Northstar Healthcare",
  "Summit Logistics",
  "Meridian Financial",
  "Bluewater Dental",
  "Elevate Home Care",
  "Cedar Property Group",
  "Apex Roofing",
  "Harbor Veterinary",
  "Pinnacle Technology",
  "Silverline Services",
  "Evergreen Electric",
  "Clearview Plumbing",
];
export const demoBootstrap: Bootstrap = {
  member: {
    email: "preview@frontline-x.com",
    display_name: "Alex Morgan",
      job_role: "Lead generator",
    role: "Admin",
    active: true,
    aliases: [],
  },
  members: [
    {
      email: "preview@frontline-x.com",
      display_name: "Alex Morgan",
      job_role: "Lead generator",
      role: "Admin",
      active: true,
      aliases: [],
    },
    {
      email: "sam@frontline-x.com",
      display_name: "Sam Rivers",
      job_role: "Sales rep",
      role: "Agent",
      active: true,
      aliases: [],
    },
  ],
  today,
  timeZone: "America/New_York",
  demo: true,
};
export const demoLeads: Lead[] = names.map((company, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  legacy_id: null,
  company,
  contact: ["James Wilson", "Emma Taylor", "Michael Chen"][i % 3],
  job_title: "Operations Director",
  email: `contact${i}@example.test`,
  phone: "+14155550123",
  country: "United States",
  industry: ["Healthcare", "Logistics", "Finance"][i % 3],
  source: ["Referral", "Outbound", "Website"][i % 3],
  score: 55 + i * 3,
  stage: STAGES[i % 9],
  status: "Active",
  value: 4500 + i * 1750,
  priority: i % 3 === 0 ? "High" : "Medium",
  notes:
    "Interested in after-hours coverage and a consistent customer experience.",
  owner_email: i % 3 === 0 ? "sam@frontline-x.com" : "preview@frontline-x.com",
  created_by: "preview@frontline-x.com",
  created_at: new Date(Date.now() - i * 86400000).toISOString(),
  original_created_date: null,
  updated_at: new Date().toISOString(),
  next_action: "Call to discuss service coverage",
  next_follow_up: new Date(Date.now() + ((i % 5) - 2) * 86400000)
    .toISOString()
    .slice(0, 10),
  stage_entered_at: new Date().toISOString(),
  closed_at: null,
  loss_reason: i % 9 === 8 ? "Timing and budget" : "",
  last_activity_at: null,
  version: 1,
  legacy_stage: "",
  legacy_owner: "",
}));
export const demoActivities: Activity[] = demoLeads.map((l, i) => ({
  id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  lead_id: l.id,
  actor_email: l.owner_email,
  actor_name: l.owner_email.startsWith("sam") ? "Sam Rivers" : "Alex Morgan",
  action: "Call",
  details: "Discussed availability and next steps.",
  outcome: ["Connected", "No answer", "Voicemail"][i % 3],
  from_stage: "",
  to_stage: "",
  deal_value: l.value,
  next_action: "",
  next_follow_up: null,
  created_at: new Date(Date.now() - i * 86400000).toISOString(),
}));
export function demoReport(
  from: string | null = null,
  to: string | null = null,
) {
  const open = demoLeads.filter((l) => !["Won", "Lost"].includes(l.stage));
  const calls = demoActivities.filter(
    (a) =>
      (!from || a.created_at.slice(0, 10) >= from) &&
      (!to || a.created_at.slice(0, 10) <= to),
  );
  const months = [
    ...new Set(calls.map((a) => a.created_at.slice(0, 7))),
  ].sort();
  return {
    total: demoLeads.length,
    open: open.length,
    open_value: open.reduce((s, l) => s + l.value, 0),
    won: 1,
    won_value: demoLeads.find((l) => l.stage === "Won")!.value,
    overdue: open.filter((l) => l.next_follow_up && l.next_follow_up < today)
      .length,
    unscheduled: 0,
    calls: calls.length,
    connected: calls.filter((a) => a.outcome === "Connected").length,
    recorded_wins: 0,
    recorded_revenue: 0,
    stages: STAGES.map((label) => ({
      label,
      count: demoLeads.filter((l) => l.stage === label).length,
    })),
    sources: ["Referral", "Outbound", "Website"].map((label) => ({
      label,
      count: 4,
    })),
    outcomes: ["Connected", "No answer", "Voicemail"].map((label) => ({
      label,
      count: calls.filter((a) => a.outcome === label).length,
    })),
    agents: demoBootstrap.members.map((m) => ({
      label: m.display_name,
      count: calls.filter((a) => a.actor_email === m.email).length,
    })),
    trend: months.map((label) => ({
      label,
      count: calls.filter((a) => a.created_at.startsWith(label)).length,
    })),
    scores: [
      { label: "50–74", count: 7 },
      { label: "75–100", count: 5 },
    ],
  };
}
