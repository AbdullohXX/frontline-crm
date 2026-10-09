import { createClient } from "@supabase/supabase-js";
import {
  quoPages,
  quoRequest,
  normalizeQuo,
  phone,
  type QuoEvent,
} from "./quo";
import type { Lead } from "./types";
export function ingestionDatabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function ingest(operation: string, payload: unknown) {
  if (!process.env.QUO_INGEST_TOKEN)
    throw Error("Quo ingestion is not configured");
  const { data, error } = await ingestionDatabase().rpc("quo_ingest", {
    token: process.env.QUO_INGEST_TOKEN,
    operation,
    payload,
  });
  if (error)
    throw Error("Could not save Quo activity. Safe to retry the sync.");
  return data;
}
export async function ingestEvents(events: QuoEvent[], delivery?: string) {
  for (let i = 0; i < events.length; i += 100)
    await ingest("events", {
      events: events.slice(i, i + 100),
      ...(delivery ? { delivery } : {}),
    });
}
export async function syncQuo(lead?: Lead, days = 30) {
  const users = await quoPages("/v1/users", true);
  await ingest(
    "users",
    users.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
      email: u.email,
    })),
  );
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const query = new URLSearchParams({
    "createdAt[gte]": from,
    include: "summary,voicemail",
  });
  if (lead) {
    const p = phone(lead.phone, lead.country);
    if (!p) throw Error("Lead needs a valid international phone number");
    query.set("participant", "+" + p);
  }
  const calls = await quoPages("/calls?" + query);
  await ingestEvents(
    calls.map((c) =>
      normalizeQuo("call", c, {}, "", c.updatedAt || c.createdAt),
    ),
  );
  // The versioned message feed accepts participant filters independently.
  let messages: any[] = [];
  if (lead) {
    const numbers = await quoRequest("/v1/phone-numbers", { legacy: true });
    for (const number of numbers.data)
      messages.push(
        ...(await quoPages(
          "/v1/messages?" +
            new URLSearchParams({
              createdAfter: from,
              participants: "+" + phone(lead.phone, lead.country),
              phoneNumberId: number.id,
            }),
          true,
        )),
      );
  } else
    messages = await quoPages(
      "/messages?" + new URLSearchParams({ "createdAt[gte]": from }),
    );
  await ingestEvents(
    messages.map((m) =>
      normalizeQuo("message", m, {}, "", m.updatedAt || m.createdAt),
    ),
  );
  await ingest("synced", {});
  return { calls: calls.length, messages: messages.length };
}
export async function syncContact(lead: Lead) {
  const p = phone(lead.phone, lead.country);
  if (!p) throw Error("Lead needs a valid international phone number");
  const existing = await quoRequest(
    "/v1/contacts?" +
      new URLSearchParams({
        externalIds: lead.id,
        sources: "frontline-crm",
        maxResults: "50",
      }),
    { legacy: true },
  );
  if (existing.data.length > 1)
    throw Error(
      "Multiple Quo contacts match this lead. Review them before syncing.",
    );
  const old = existing.data[0];
  const [firstName, ...rest] = (lead.contact || lead.company)
    .trim()
    .split(/\s+/);
  // Quo PATCH replaces array fields; preserve every existing field instead of
  // deleting emails, phone numbers, or custom properties owned by the team.
  const merge = (rows: any[] = [], value: string, name: string) => {
    const cleaned = rows.map(({ id, ...r }) => r);
    if (value && !cleaned.some((r) => r.value === value))
      cleaned.push({ name, value });
    return cleaned;
  };
  const payload = {
    defaultFields: {
      ...(old?.defaultFields || {}),
      firstName,
      lastName: rest.join(" "),
      company: lead.company,
      role: lead.job_title,
      emails: merge(old?.defaultFields?.emails, lead.email, "CRM email"),
      phoneNumbers: merge(
        old?.defaultFields?.phoneNumbers,
        "+" + p,
        "CRM phone",
      ),
    },
    customFields: (old?.customFields || []).map(({ key, value }: any) => ({
      key,
      value,
    })),
    externalId: lead.id,
    source: "frontline-crm",
    sourceUrl: process.env.APP_URL,
  };
  const result = await quoRequest(
    old ? "/v1/contacts/" + encodeURIComponent(old.id) : "/v1/contacts",
    { legacy: true, method: old ? "PATCH" : "POST", body: payload },
  );
  return { created: !old, id: result.data.id };
}
export async function syncQueuedContacts(limit = 25, lead?: string) {
  const queue = await ingest("contacts", { limit, lead });
  let synced = 0,
    failed = 0;
  for (const item of queue) {
    let ok = false;
    try {
      await syncContact(item.lead);
      ok = true;
      synced++;
    } catch {
      failed++;
    }
    await ingest("contact_done", {
      lead: item.lead.id,
      lease: item.lease,
      version: item.version,
      ok,
    });
  }
  return { synced, failed };
}
