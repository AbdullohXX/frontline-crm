export const STAGES = [
  "New",
  "Contacted",
  "Follow-up 1",
  "Follow-up 2",
  "Follow-up 3",
  "Meeting Booked",
  "Negotiation",
  "Won",
  "Lost",
] as const;
export const OUTCOMES = [
  "Connected",
  "No answer",
  "Voicemail",
  "Sent",
  "Completed",
  "Rescheduled",
  "Not interested",
  "Other",
] as const;
export type Member = {
  avatar_color?: string;
  avatar_image?: string;
  email: string;
  display_name: string;
  role: "Admin" | "Agent";
  active: boolean;
  aliases: string[];
  can_export?: boolean;
  can_archive?: boolean;
  can_ai?: boolean;
  can_shared_sms?: boolean;
  job_role?: "Lead generator" | "Sales rep" | "Other";
};
export type Lead = {
  id: string;
  legacy_id: string | null;
  stage_actor?: string | null;
  sales_assignee?: string | null;
  handoff_status?: string;
  handoff_at?: string | null;
  handoff_note?: string;
  company: string;
  contact: string;
  job_title: string;
  email: string;
  phone: string;
  country: string;
  industry: string;
  source: string;
  score: number | null;
  stage: (typeof STAGES)[number];
  status: "Active" | "Inactive" | "Pending";
  value: number;
  priority: "High" | "Medium" | "Low";
  notes: string;
  owner_email: string;
  created_by: string | null;
  created_at: string;
  original_created_date: string | null;
  updated_at: string;
  next_action: string;
  next_follow_up: string | null;
  stage_entered_at: string | null;
  closed_at: string | null;
  loss_reason: string;
  last_activity_at: string | null;
  version: number;
  legacy_stage: string;
  legacy_owner: string;
  time_zone?: string;
  work_status?: string;
  archived_at?: string | null;
};
export type Activity = {
  id: string;
  lead_id: string;
  actor_email: string;
  actor_name: string;
  action: string;
  details: string;
  outcome: string;
  from_stage: string;
  to_stage: string;
  deal_value: number;
  next_action: string;
  next_follow_up: string | null;
  created_at: string;
};
export type Bootstrap = {
  member: Member;
  members: Member[];
  timeZone: string;
  today: string;
  demo: boolean;
  workAddress?: string;
  teamPhone?: string;
};
export type LeadInput = Pick<
  Lead,
  | "company"
  | "contact"
  | "job_title"
  | "email"
  | "phone"
  | "country"
  | "industry"
  | "source"
  | "score"
  | "stage"
  | "status"
  | "value"
  | "priority"
  | "notes"
  | "owner_email"
  | "next_action"
  | "next_follow_up"
  | "loss_reason"
  | "time_zone"
  | "work_status"
>;
