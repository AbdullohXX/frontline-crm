import { authorized, localDemo } from "@/lib/auth";
import { json, failure, sameOrigin, body } from "@/lib/http";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    if (localDemo())
      return json({ sessions: [], attempts: [], calls: [], generators: [] });
    const { db, member } = await authorized();
    const q = new URL(request.url).searchParams;
    if (q.get("mode") === "session") {
      const { data: sessions, error } = await db
        .from("calling_sessions")
        .select("*")
        .eq("rep", member.email)
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString());
      if (error) throw Error("Session unavailable");
      const ids = (sessions || []).map((s) => s.id);
      const { data: attempts, error: ae } = ids.length
        ? await db
            .from("calling_attempts")
            .select("*,sales_calls(call_id)")
            .in("session_id", ids)
            .is("cancelled_at", null)
            .gt("started_at", new Date(Date.now() - 600000).toISOString())
        : { data: [], error: null };
      if (ae) throw Error("Attempts unavailable");
      return json({
        sessions,
        attempts: (attempts || []).filter((a: any) => !a.sales_calls?.length),
      });
    }
    if (q.get("call")) {
      const id = z
        .string()
        .regex(/^AC[a-zA-Z0-9_-]{1,145}$/)
        .parse(q.get("call"));
      const [event, claim] = await Promise.all([
        db
          .from("quo_events")
          .select("id,lead_id,direction,status")
          .eq("id", id)
          .eq("kind", "call")
          .maybeSingle(),
        db
          .from("sales_calls")
          .select("rep,outcome,attribution,disposition")
          .eq("call_id", id)
          .maybeSingle(),
      ]);
      if (event.error || claim.error)
        throw Error("Could not read call attribution");
      if (!event.data) return json({ error: "Call unavailable" }, 404);
      const { data: lead } = event.data.lead_id
        ? await db
            .from("leads")
            .select("version,next_action,next_follow_up")
            .eq("id", event.data.lead_id)
            .maybeSingle()
        : { data: null };
      return json({
        lead,
        claim: claim.data,
        canConfirm:
          event.data.direction === "outgoing" &&
          !!claim.data &&
          (member.role === "Admin" || claim.data.rep === member.email),
      });
    }
    const from = z.iso
      .date()
      .parse(
        q.get("from") ||
          new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      );
    const to = z.iso
      .date()
      .parse(q.get("to") || new Date().toISOString().slice(0, 10));
    if (from > to) throw Error("Invalid date range");
    const { data: bounds, error: be } = await db.rpc("crm_day_bounds", {
      day_from: from,
      day_to: to,
    });
    if (be || !bounds) throw Error("Reporting timezone unavailable");
    async function collect(query: any) {
      const rows: any[] = [];
      for (let offset = 0; offset < 50000; offset += 1000) {
        const { data, error } = await query.range(offset, offset + 999);
        if (error) throw Error("Could not load complete KPI data");
        rows.push(...data);
        if (data.length < 1000) return { data: rows, error: null };
      }
      throw Error("Reporting exceeds 50,000 records. Select a smaller range.");
    }
    const [sessions, attempts, claims, events, leads] = await Promise.all([
      db
        .from("calling_sessions")
        .select("*")
        .eq("rep", member.email)
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString()),
      collect(
        db
          .from("calling_attempts")
          .select("*")
          .gte("started_at", bounds.from)
          .lt("started_at", bounds.to)
          .order("started_at", { ascending: false })
          .order("id"),
      ),
      collect(db.from("sales_calls").select("*").order("call_id")),
      collect(
        db
          .from("quo_events")
          .select("id,lead_id,phone,status,connected,duration,occurred_at")
          .eq("kind", "call")
          .eq("direction", "outgoing")
          .gte("occurred_at", bounds.from)
          .lt("occurred_at", bounds.to)
          .order("occurred_at", { ascending: false })
          .order("id"),
      ),
      collect(
        db
          .from("leads")
          .select("id,company,created_by,created_at,stage,phone,email")
          .gte("created_at", bounds.from)
          .lt("created_at", bounds.to)
          .order("id"),
      ),
    ]);
    if ([sessions, attempts, claims, events, leads].some((r) => r.error))
      throw Error("Calling dashboard unavailable");
    return json({
      sessions: sessions.data,
      attempts: attempts.data,
      calls: events.data!.map((e) => ({
        ...e,
        ...claims.data!.find((c) => c.call_id === e.id),
      })),
      generators: leads.data,
      limitReached: [attempts, events, leads, claims].some(
        (r) => r.data!.length >= 1000,
      ),
      timeZone: bounds.timeZone,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo())
      return json({ error: "Calling attribution needs the live CRM." }, 403);
    const { db } = await authorized();
    const p = z
      .object({
        action: z.enum([
          "start",
          "stop",
          "attempt",
          "launch",
          "cancel",
          "outcome",
          "assign",
        ]),
        lead_id: z.uuid().optional(),
        call_id: z.string().max(160).optional(),
        phone: z.string().max(60).optional(),
        attempt_id: z.uuid().optional(),
        reason: z.string().max(1000).optional(),
        disposition: z.string().max(40).optional(),
        version: z.number().int().positive().optional(),
        stage: z.string().max(40).optional(),
        loss_reason: z.string().max(500).optional(),
        next_action: z.string().max(300).optional(),
        next_follow_up: z.union([z.iso.date(), z.literal("")]).optional(),
        rep: z.email().optional(),
        outcome: z.string().max(40).optional(),
      })
      .parse(await body(request));
    const { data, error } = await db.rpc("sales_call_action", { p });
    if (error) throw Error(error.message);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
