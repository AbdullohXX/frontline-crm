import { authorized, localDemo, HttpError } from "@/lib/auth";
import { body, failure, json, sameOrigin } from "@/lib/http";
import { demoActivities, demoLeads } from "@/lib/demo";
import { z } from "zod";
const fileSchema = z.object({
  path: z.string().max(250),
  name: z.string().min(1).max(200),
  mime: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/mp4",
    "audio/webm",
  ]),
  size: z.number().int().positive().max(26214400),
});
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const id = z.uuid().parse(q.get("lead"));
    const before = q.get("before");
    const beforeId = q.get("beforeId");
    if (before) {
      z.iso.datetime({ offset: true }).parse(before);
      z.uuid().parse(beforeId);
    }
    if (localDemo())
      return json({
        events: demoActivities
          .filter((a) => a.lead_id === id)
          .map((a) => ({ ...a, attachments: [] })),
        hasMore: false,
        lead: demoLeads.find((l) => l.id === id),
      });
    const { db } = await authorized();
    const { data: lead, error: le } = await db
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();
    if (le || !lead) throw new HttpError("Lead not available.", 404);
    let query = db
      .from("activities")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(101);
    if (before)
      query = query.or(
        "created_at.lt." +
          before +
          ",and(created_at.eq." +
          before +
          ",id.lt." +
          beforeId +
          ")",
      );
    const { data, error } = await query;
    if (error) throw Error("Could not load conversation.");
    const events = (data || []).slice(0, 100);
    let attachments: any[] = [];
    if (events.length) {
      const { data: files, error: fe } = await db
        .from("lead_attachments")
        .select("*")
        .in(
          "activity_id",
          events.map((a) => a.id),
        );
      if (fe) throw Error("Could not load attachments.");
      attachments = files || [];
    }
    const { data: quo, error: qe } = events.length
      ? await db
          .from("quo_events")
          .select("*")
          .eq("lead_id", id)
          .in(
            "activity_id",
            events.map((a) => a.id),
          )
      : { data: [], error: null };
    if (qe) throw Error("Could not load Quo history.");
    return json({
      lead,
      hasMore: (data || []).length > 100,
      events: events.map((a) => ({
        ...a,
        quo: quo?.find((e) => e.activity_id === a.id),
        attachments: attachments
          .filter((f) => f.activity_id === a.id)
          .map((f) => ({
            ...f,
            url: "/api/media?id=" + f.id,
          })),
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo()) throw new HttpError("Preview is read-only.", 403);
    const { db } = await authorized();
    const p = z
      .object({
        lead_id: z.uuid(),
        message: z.string().trim().max(4000),
        attachments: z.array(fileSchema).max(4).default([]),
      })
      .refine(
        (p) => !!p.message || p.attachments.length > 0,
        "Add a message or attachment",
      )
      .parse(await body(request));
    if (p.attachments.some((f) => !f.path.startsWith(p.lead_id + "/")))
      throw new HttpError("Attachment belongs to another lead.", 400);
    const { data, error } = await db.rpc("post_lead_message", { p }).single();
    if (error) throw Error(error.message);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
