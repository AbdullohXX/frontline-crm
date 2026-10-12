import { authorized, localDemo } from "@/lib/auth";
import { json, failure, sameOrigin, body } from "@/lib/http";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    if (localDemo())
      return json({ sessions: [], attempts: [], calls: [], generators: [] });
    const { db, member } = await authorized();
    const q = new URL(request.url).searchParams;
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
          .gte("started_at", from + "T00:00:00Z")
          .lt("started_at", new Date(Date.parse(to) + 86400000).toISOString())
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
          .gte("occurred_at", from + "T00:00:00Z")
          .lt("occurred_at", new Date(Date.parse(to) + 86400000).toISOString())
          .order("occurred_at", { ascending: false })
          .order("id"),
      ),
      collect(
        db
          .from("leads")
          .select("id,company,created_by,created_at,stage,phone,email")
          .gte("created_at", from + "T00:00:00Z")
          .lt("created_at", new Date(Date.parse(to) + 86400000).toISOString())
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
      timeZone: "UTC",
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
        action: z.enum(["start", "stop", "attempt", "outcome", "assign"]),
        lead_id: z.uuid().optional(),
        call_id: z.string().max(160).optional(),
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
