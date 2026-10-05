import { authorized, localDemo } from "@/lib/auth";
import { json, failure } from "@/lib/http";
import { date } from "@/lib/validation";
import { analytics } from "@/lib/analytics";
import { demoLeads, demoActivities, demoBootstrap } from "@/lib/demo";
import type { Lead, Activity } from "@/lib/types";
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams,
      from = q.get("from")?.trim() || null,
      to = q.get("to")?.trim() || null;
    if (from) date.parse(from);
    if (to) date.parse(to);
    if (from && to && from > to)
      throw new Error("From date must be before Through date.");
    const owner = q.get("owner") || "",
      source = q.get("source") || "";
    if (localDemo())
      return json(
        analytics(demoLeads, demoActivities, demoBootstrap.members, {
          from,
          to,
          owner,
          source,
          today: demoBootstrap.today,
          timeZone: demoBootstrap.timeZone,
        }),
      );
    const { db } = await authorized();
    const [
      { data: settings, error: settingsError },
      { data: members, error: membersError },
    ] = await Promise.all([
      db.from("crm_settings").select("time_zone").single(),
      db.from("team_members").select("*"),
    ]);
    if (settingsError || membersError)
      throw new Error("Could not read reporting settings.");
    const timeZone = settings.time_zone;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    // Fetch every RLS-visible page, never just the 100-row workspace page.
    async function collect(table: "leads" | "activities", columns: string) {
      const rows: unknown[] = [];
      for (let offset = 0; offset <= 50000; offset += 1000) {
        let query = db
          .from(table)
          .select(columns)
          .order("id")
          .range(offset, offset + 999);
        if(table === 'leads') query = query.is('archived_at',null);
        const {data,error} = await query;
        if (error) throw new Error("Could not load analytics records.");
        rows.push(...data);
        if (rows.length > 50000)
          throw new Error(
            "Analytics exceeds 50,000 records. A database aggregation upgrade is required.",
          );
        if (data.length < 1000) return rows;
      }
      return rows;
    }
    const [leads, events] = await Promise.all([
      collect(
        "leads",
        "id,company,stage,value,owner_email,source,score,status,priority,next_follow_up,created_at,original_created_date,stage_entered_at,industry,country,loss_reason,email,phone",
      ),
      collect(
        "activities",
        "id,lead_id,actor_email,actor_name,action,outcome,from_stage,to_stage,deal_value,created_at",
      ),
    ]);
    return json(
      analytics(leads as Lead[], events as Activity[], members, {
        from,
        to,
        owner,
        source,
        today,
        timeZone,
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
