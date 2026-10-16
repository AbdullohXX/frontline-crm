import { authorized, localDemo, HttpError } from "@/lib/auth";
import { json, failure, sameOrigin, body } from "@/lib/http";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    if (localDemo()) return json({ leads: [] });
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(new URL(request.url).searchParams.get("page") || 0);
    const { db, member } = await authorized();
    let q = db
      .from("leads")
      .select("*")
      .is("archived_at", null)
      .in("handoff_status", ["Pending", "Returned"])
      .order("handoff_at", { ascending: false, nullsFirst: false })
      .order("id")
      .range(page * 25, page * 25 + 25);
    if (member.role !== "Admin")
      q = q.or(
        "sales_assignee.eq." +
          member.email +
          ",created_by.eq." +
          member.email +
          ",owner_email.eq." +
          member.email,
      );
    const { data, error } = await q;
    if (error) throw Error("Could not load handoffs");
    return json({
      leads: (data || []).slice(0, 25),
      hasMore: (data || []).length > 25,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    sameOrigin(r);
    if (localDemo()) throw new HttpError("Preview is read-only", 403);
    const { db } = await authorized();
    const p = z
      .object({
        action: z.enum(["submit", "accept", "return"]),
        lead_id: z.uuid(),
        version: z.number().int().positive(),
        rep: z.email().optional(),
        note: z.string().max(1000).default(""),
      })
      .parse(await body(r));
    const { data, error } = await db.rpc("handoff_lead", { p });
    if (error) throw Error(error.message);
    return json({ lead: data });
  } catch (e) {
    return failure(e);
  }
}
