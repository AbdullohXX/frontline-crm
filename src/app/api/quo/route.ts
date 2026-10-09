import { z } from "zod";
import { createHash } from "node:crypto";
import { authorized, localDemo, HttpError } from "@/lib/auth";
import { body, sameOrigin, failure, json } from "@/lib/http";
import { demoBootstrap, demoLeads } from "@/lib/demo";
import {
  quoRequest,
  quoPages,
  normalizeQuo,
  phone,
  callMetrics,
} from "@/lib/quo";
import { ingest, ingestEvents, syncQuo, syncContact } from "@/lib/quo-server";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    if (localDemo()) {
      const sampleUsers = [
        {
          id: "USdemo",
          name: "Sample Quo user",
          email: "demo@frontline-x.com",
          member_email: demoBootstrap.member.email,
        },
      ];
      const sample = Array.from({ length: 12 }, (_, i) =>
        normalizeQuo("call", {
          id: "ACdemo" + i,
          createdAt: new Date(Date.now() - i * 86400000).toISOString(),
          direction: i % 3 ? "outgoing" : "incoming",
          status: i % 4 ? "completed" : "missed",
          answeredAt: i % 4 ? new Date().toISOString() : null,
          duration: i % 4 ? 60 + i * 12 : 0,
          actorId: "USdemo",
          participants: [{ phoneNumber: "+14155550123", actorId: null }],
        }),
      );
      const mode = new URL(request.url).searchParams.get("mode");
      if (mode === "report")
        return json({ ...callMetrics(sample), users: sampleUsers });
      if (mode === "setup")
        return json({
          configured: true,
          demo: true,
          webhookReady: false,
          users: sampleUsers,
          numbers: [
            {
              id: "PNdemo",
              name: "Sample number",
              number: "+14155550100",
              canSend: true,
            },
          ],
        });
      return json({
        configured: true,
        demo: true,
        users: sampleUsers,
        events: sample.map((e) => ({ ...e, lead_id: demoLeads[0].id })),
        hasMore: false,
      });
    }
    const { db, member } = await authorized();
    const q = new URL(request.url).searchParams;
    const { data: users, error: ue } = await db.from("quo_users").select("*");
    if (ue) throw Error("Quo database setup is incomplete");
    if (q.get("mode") === "report") {
      const start = z.iso.date().parse(q.get("start")),
        end = z.iso.date().parse(q.get("end"));
      const { data, error } = await db.rpc("quo_report", {
        start_at: start + "T00:00:00Z",
        end_at: new Date(Date.parse(end) + 86400000).toISOString(),
        actor_id: q.get("actor") || "",
        tz: "America/New_York",
      });
      if (error) throw Error("Quo analytics unavailable");
      return json({ ...data, users });
    }
    if (q.get("mode") === "setup") {
      let numbers: any[] = [];
      if (process.env.QUO_API_KEY) {
        const result = await quoRequest("/v1/phone-numbers", { legacy: true });
        const mine = (users || [])
          .filter((u) => u.member_email === member.email)
          .map((u) => u.id);
        numbers = result.data.map((n: any) => ({
          id: n.id,
          name: n.name,
          number: n.number,
          canSend: n.users.some((u: any) => mine.includes(u.id)),
          restrictions: n.restrictions,
        }));
      }
      return json({
        configured: !!process.env.QUO_API_KEY,
        webhookReady: !!process.env.QUO_WEBHOOK_KEY,
        users,
        numbers,
        ...(process.env.QUO_INGEST_TOKEN ? await ingest("status", {}) : {}),
      });
    }
    let query = db
      .from("quo_events")
      .select("*")
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (q.get("lead"))
      query = query.eq("lead_id", z.uuid().parse(q.get("lead")));
    if (q.get("unmatched") === "true") {
      if (member.role !== "Admin") throw new HttpError("Admin required", 403);
      query = query.is("lead_id", null);
    }
    if (q.get("kind"))
      query = query.eq(
        "kind",
        z.enum(["call", "message"]).parse(q.get("kind")),
      );
    if (q.get("before")) {
      const date = z.iso.datetime({ offset: true }).parse(q.get("before"));
      const id = z
        .string()
        .regex(/^AC[a-zA-Z0-9_-]+$/)
        .parse(q.get("beforeId"));
      query = query.or(
        `occurred_at.lt.${date},and(occurred_at.eq.${date},id.lt.${id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw Error("Quo activity unavailable");
    return json({
      events: (data || []).slice(0, 50),
      hasMore: (data || []).length > 50,
      users,
      configured: !!process.env.QUO_API_KEY,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo()) throw new HttpError("Preview is read-only", 403);
    const { db, member } = await authorized();
    const p = z
      .object({
        operation: z.enum([
          "sync",
          "sync_contact",
          "send_sms",
          "map_user",
          "link",
        ]),
        lead: z.uuid().optional(),
        id: z.string().max(150).optional(),
        email: z.email().optional(),
        from: z
          .string()
          .regex(/^PN[a-zA-Z0-9_-]+$/)
          .optional(),
        text: z.string().trim().min(1).max(1600).optional(),
        request_id: z.uuid().optional(),
      })
      .parse(await body(request));
    if (p.operation === "map_user" || p.operation === "link") {
      if (member.role !== "Admin") throw new HttpError("Admin required", 403);
      const { error } = await db.rpc("quo_manage", { p });
      if (error) throw Error("Could not update Quo mapping");
      return json({ ok: true });
    }
    let lead: any;
    if (p.lead) {
      const { data, error } = await db
        .from("leads")
        .select("*")
        .eq("id", p.lead)
        .single();
      if (error || !data) throw new HttpError("Lead unavailable", 404);
      lead = data;
    }
    if (p.operation === "sync") {
      if (member.role !== "Admin" && !lead)
        throw new HttpError("Admin required for workspace sync", 403);
      const result = await syncQuo(lead);
      if (lead) {
        const { data: saved } = await db
          .from("leads")
          .select("*")
          .eq("id", lead.id)
          .single();
        return json({ ...result, lead: saved });
      }
      return json(result);
    }
    if (!lead || lead.archived_at)
      throw new HttpError("Select an active lead first", 400);
    if (p.operation === "sync_contact") return json(await syncContact(lead));
    if (!p.text || !p.from || !p.request_id)
      throw new HttpError("Message, sender and request ID required", 400);
    const recipient = phone(lead.phone, lead.country);
    if (!recipient)
      throw new HttpError("Lead needs an international phone number", 400);
    const { data: users, error: ue } = await db
      .from("quo_users")
      .select("id")
      .eq("member_email", member.email);
    if (ue) throw Error("Could not verify sender");
    const numbers = await quoRequest("/v1/phone-numbers", { legacy: true });
    const number = numbers.data.find((n: any) => n.id === p.from);
    const sender = number?.users.find((u: any) =>
      users?.some((m) => m.id === u.id),
    );
    if (!sender)
      throw new HttpError(
        "Your CRM account needs a Quo user assigned to this number. Ask an administrator to map it.",
        403,
      );
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([lead.id, recipient, p.from, p.text]))
      .digest("hex");
    const reservation = await ingest("reserve_sms", {
      id: p.request_id,
      actor: member.email,
      fingerprint,
      lead_id: lead.id,
    });
    if (!reservation.reserved)
      return json(
        {
          error:
            reservation.status === "sent"
              ? "This message was already submitted. Refresh its delivery status."
              : "The earlier submission may have reached Quo. Check Quo before sending again.",
        },
        409,
      );
    let result;
    try {
      result = await quoRequest("/v1/messages", {
        legacy: true,
        method: "POST",
        body: {
          content: p.text,
          from: p.from,
          to: ["+" + recipient],
          userId: sender.id,
        },
      });
    } catch (e) {
      await ingest("finish_sms", { id: p.request_id, status: "uncertain" });
      throw e;
    }
    await ingest("finish_sms", {
      id: p.request_id,
      status: "sent",
      provider_id: result.data.id,
    });
    const event = normalizeQuo(
      "message",
      result.data,
      {},
      "",
      result.data.updatedAt || result.data.createdAt,
    );
    event.actor_email = member.email;
    event.lead_id = lead.id;
    await ingestEvents([event]);
    const { data: saved } = await db
      .from("leads")
      .select("*")
      .eq("id", lead.id)
      .single();
    return json({ ok: true, status: result.data.status, lead: saved });
  } catch (e) {
    return failure(e);
  }
}
