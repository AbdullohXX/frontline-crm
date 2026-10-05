import { z } from "zod";
import { STAGES, OUTCOMES } from "./types";
import { WORK_STATUSES, ZONES } from "./workflow";
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, "Enter a valid date");
export const leadSchema = z
  .object({
    company: z.string().trim().min(1).max(200),
    contact: z.string().trim().max(200).default(""),
    job_title: z.string().trim().max(200).default(""),
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: z
      .string()
      .max(60)
      .refine(
        (v) =>
          !v ||
          (/^\+?[\d\s().-]+$/.test(v) &&
            v.replace(/\D/g, "").length >= 7 &&
            v.replace(/\D/g, "").length <= 15),
        "Phone must have 7–15 digits",
      )
      .default(""),
    country: z.string().max(200).default(""),
    industry: z.string().max(200).default(""),
    source: z.string().max(200).default(""),
    score: z.number().min(0).max(100).nullable().default(null),
    stage: z.enum(STAGES),
    status: z.enum(["Active", "Inactive", "Pending"]).default("Active"),
    value: z.number().min(0).max(1e12).default(0),
    priority: z.enum(["High", "Medium", "Low"]).default("Medium"),
    notes: z.string().max(10000).default(""),
    owner_email: z.email().toLowerCase(),
    next_action: z.string().max(300).default(""),
    next_follow_up: date.nullable().default(null),
    loss_reason: z.string().max(500).default(""),
    work_status: z.enum(WORK_STATUSES).default("None"),
    time_zone: z
      .string()
      .refine(
        (v) => v === "" || ZONES.some(([z]) => z === v),
        "Choose a supported timezone",
      )
      .default(""),
  })
  .refine((v) => v.stage !== "Lost" || !!v.loss_reason.trim(), {
    message: "Add a loss reason",
    path: ["loss_reason"],
  })
  .refine((v) => !v.next_action || !!v.next_follow_up, {
    message: "A next action requires a follow-up date",
    path: ["next_follow_up"],
  });
export const activitySchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    type: z.enum(["Call", "Email", "Meeting", "Note"]),
    outcome: z.enum(OUTCOMES),
    details: z.string().trim().min(1).max(4000),
    next_action: z.string().trim().max(300).default(""),
    next_follow_up: date.nullable().default(null),
    complete: z.boolean().default(false),
  })
  .refine((v) => !!v.next_action === !!v.next_follow_up, {
    message: "Provide both a next action and date, or leave both blank",
  });
export const memberSchema = z.object({
  email: z
    .email()
    .toLowerCase()
    .refine(
      (v) => v.endsWith("@frontline-x.com"),
      "Use a frontline-x.com account",
    ),
  display_name: z.string().trim().min(1).max(80),
  role: z.enum(["Admin", "Agent"]),
  active: z.boolean(),
  aliases: z
    .array(z.string().trim().toLowerCase().max(200))
    .max(30)
    .default([]),
});
export function message(error: unknown) {
  return error instanceof z.ZodError
    ? error.issues
        .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
        .join("; ")
    : error instanceof Error
      ? error.message
      : "Unexpected error";
}
