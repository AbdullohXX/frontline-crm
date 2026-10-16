import { authorized, localDemo, HttpError } from "@/lib/auth";
import { json, failure } from "@/lib/http";
import { z } from "zod";
import { outreachInsight } from "@/lib/lead-insight";
import { demoLeads, demoBootstrap } from "@/lib/demo";
export async function GET(r: Request) {
  try {
    const id = z.uuid().parse(new URL(r.url).searchParams.get("lead"));
    if (localDemo()) {
      const l = demoLeads.find((x) => x.id === id);
      if (!l) throw new HttpError("Lead unavailable", 404);
      return json({
        insight: outreachInsight(l, demoBootstrap.today, false, false),
        call: null,
        email: null,
        emails: [],
        mailboxConnected: false,
        period: "Recorded history",
        recipient: l.email,
      });
    }
    const { db, member } = await authorized();
    const { data: lead, error } = await db
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !lead) throw new HttpError("Lead unavailable", 404);
    const cycle = lead.stage.startsWith("Follow-up")
      ? lead.stage_entered_at
      : null;
    let cq = db
      .from("quo_events")
      .select(
        "id,status,direction,occurred_at,sales_calls!inner(rep,outcome,disposition)",
      )
      .eq("lead_id", id)
      .eq("kind", "call")
      .eq("direction", "outgoing")
      .eq("sales_calls.rep", member.email)
      .in("status", [
        "completed",
        "missed",
        "no-answer",
        "failed",
        "busy",
        "canceled",
      ])
      .order("occurred_at", { ascending: false })
      .limit(1);
    let eq = db
      .from("verified_sent_emails")
      .select("sender,recipient,subject,sent_at")
      .eq("lead_id", id)
      .eq("sender", member.email)
      .order("sent_at", { ascending: false })
      .limit(1);
    if (cycle) {
      cq = cq.gte("occurred_at", cycle);
      eq = eq.gte("sent_at", cycle);
    }
    const [
      { data: settings },
      { data: contacts, error: ce },
      { data: mail, error: me },
      { data: calls, error: qe },
      { data: ownMail, error: oe },
      { data: session },
    ] = await Promise.all([
      db.from("crm_settings").select("time_zone").single(),
      db
        .from("lead_contacts")
        .select("email,phone")
        .eq("lead_id", id)
        .is("archived_at", null),
      db
        .from("verified_sent_emails")
        .select("sender,recipient,subject,sent_at")
        .eq("lead_id", id)
        .order("sent_at", { ascending: false })
        .limit(100),
      cq,
      eq,
      db.auth.getSession(),
    ]);
    if (ce || me || qe || oe) throw Error("Could not load verified outreach");
    const zone = settings?.time_zone || "America/New_York";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (v: string) => parts.find((p) => p.type === v)!.value;
    const today = part("year") + "-" + part("month") + "-" + part("day");
    const event = calls?.[0];
    const claim = event
      ? Array.isArray(event.sales_calls)
        ? event.sales_calls[0]
        : event.sales_calls
      : null;
    const call = event ? { ...claim, occurred_at: event.occurred_at } : null;
    const email = ownMail?.[0];
    return json({
      insight: outreachInsight(
        {
          ...lead,
          email:
            lead.email || (contacts || []).find((c) => c.email)?.email || "",
          phone:
            lead.phone || (contacts || []).find((c) => c.phone)?.phone || "",
        },
        today,
        !!call,
        !!email,
      ),
      call,
      email: email || null,
      emails: mail || [],
      mailboxConnected: !!session.session?.provider_token,
      period: cycle ? "This follow-up stage" : "Recorded history",
      recipient:
        lead.email || (contacts || []).find((c) => c.email)?.email || "",
      timeZone: zone,
    });
  } catch (e) {
    return failure(e);
  }
}
