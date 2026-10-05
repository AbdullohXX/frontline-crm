import { authorized, localDemo, HttpError } from "@/lib/auth";
import { json, failure, sameOrigin, body } from "@/lib/http";
import { leadSchema, date } from "@/lib/validation";
import { demoLeads, demoBootstrap } from "@/lib/demo";
import { callingInfo, leadZone } from "@/lib/workflow";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const p = {
      page: Math.floor(
        Math.max(0, Math.min(10000, Number(q.get("page")) || 0)),
      ),
      search: (q.get("search") || "")
        .trim()
        .slice(0, 200)
        .replace(/[,%()_\\]/g, " "),
      scope: q.get("scope") || "",
      stage: q.get("stage") || "",
      owner: q.get("owner") || "",
      work_status: q.get("work_status") || "",
      date: q.get("date") || "",
      date_field: q.get("date_field") || "created",
      tz: q.get("tz") || "",
      archived: q.get("archived") || "false",
      phone: q.get("phone") || "",
      due: q.get("due") || "",
      today: q.get("today") || new Date().toISOString().slice(0, 10),
    };
    date.parse(p.today);
    if (p.date) date.parse(p.date);
    if (localDemo()) {
      let rows = demoLeads.filter(
        (l) =>
          (p.archived === "true") === !!l.archived_at &&
          (!p.search ||
            [l.company, l.contact, l.email, l.phone, l.legacy_id]
              .join(" ")
              .toLowerCase()
              .includes(p.search.toLowerCase())) &&
          (!p.stage || l.stage === p.stage) &&
          (!p.owner || l.owner_email === p.owner) &&
          (!p.work_status || (l.work_status || "None") === p.work_status) &&
          (p.scope !== "mine" ||
            l.owner_email === demoBootstrap.member.email) &&
          (!p.date ||
            (p.date_field === "followup"
              ? l.next_follow_up
              : l.original_created_date || l.created_at.slice(0, 10)) ===
              p.date) &&
          (!p.tz ||
            (p.tz === "calling"
              ? callingInfo(l).open
              : p.tz === "unknown"
                ? !leadZone(l)
                : leadZone(l) === p.tz)) &&
          (p.phone !== "true" || !!l.phone),
      );
      if (p.due)
        rows = rows.filter(
          (l) =>
            !["Won", "Lost"].includes(l.stage) &&
            (p.due === "open"
              ? true
              : p.due === "unscheduled"
                ? !l.next_follow_up
                : p.due === "upcoming"
                  ? (l.next_follow_up || "") > p.today
                  : p.due === "today"
                    ? l.next_follow_up === p.today
                    : !!l.next_follow_up &&
                      (p.due === "overdue"
                        ? l.next_follow_up < p.today
                        : l.next_follow_up <= p.today)),
        );
      return json({
        leads: rows.slice(p.page * 100, (p.page + 1) * 100),
        total: rows.length,
        page: p.page,
      });
    }
    const { db } = await authorized();
    const { data, error } = await db.rpc("crm_list_leads", { p });
    if (error) throw new Error(error.message);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo())
      throw new HttpError(
        "Preview is read-only. Connect Supabase to save real records.",
        403,
      );
    const { db } = await authorized();
    const input = await body(request);
    const data = leadSchema.parse(input);
    const meta = z
      .object({
        id: z.uuid().optional(),
        version: z.number().int().positive().optional(),
        duplicate_reason: z.string().max(300).optional(),
      })
      .parse(input);
    const { data: saved, error } = await db
      .rpc("save_lead", { p: { ...data, ...meta } })
      .single();
    if (error) throw new Error(error.message);
    return json(saved);
  } catch (e) {
    return failure(e);
  }
}
