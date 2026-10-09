import { authorized, localDemo } from "@/lib/auth";
import { json, failure, sameOrigin, body } from "@/lib/http";
import { z } from "zod";
export async function GET() {
  try {
    if (localDemo()) return json({ targets: [], presence: [], usage: [] });
    const { db } = await authorized();
    const results = await Promise.all([
      db.from("agent_targets").select("*"),
      db.from("agent_presence").select("*"),
      db
        .from("agent_usage")
        .select("*")
        .gte(
          "day",
          new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
        ),
    ]);
    if (results.some((r) => r.error))
      throw Error("Could not load team productivity");
    return json({
      targets: results[0].data,
      presence: results[1].data,
      usage: results[2].data,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo()) return json({ preview: true });
    const p = await body(request);
    const { db } = await authorized(p.action === "targets");
    if (p.action === "targets") {
      const row = z
        .object({
          email: z.email(),
          calls: z.number().int().min(1).max(10000),
          emails: z.number().int().min(1).max(10000),
        })
        .parse(p);
      const { error } = await db.from("agent_targets").upsert(row);
      if (error) throw Error("Could not save targets");
    } else {
      const { error } = await db.rpc("record_presence");
      if (error) throw Error("Could not record active time");
    }
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
