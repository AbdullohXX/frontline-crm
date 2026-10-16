import { createHmac, timingSafeEqual } from "node:crypto";
export const QUO_VERSION = "2026-03-30";
export type QuoEvent = {
  id: string;
  kind: "call" | "message";
  phone: string;
  phone_number_id: string;
  user_id: string;
  direction: string;
  status: string;
  connected: boolean;
  duration: number;
  content: string;
  occurred_at: string;
  source_updated_at: string;
  payload: Record<string, unknown>;
  actor_email?: string;
  lead_id?: string;
};
export function phone(value: unknown, country = "") {
  if (typeof value !== "string") return "";
  let d = value.replace(/[^0-9]/g, "");
  if (
    d.length === 10 &&
    /^(U S A|U S|USA|US|UNITED STATES OF AMERICA|UNITED STATES|CA|CANADA)( |$)/.test(
      country
        .toUpperCase()
        .replace(/[^A-Z]+/g, " ")
        .trim(),
    )
  )
    d = "1" + d;
  return /^[1-9][0-9]{6,14}$/.test(d) ? d : "";
}
const timestamp = (v: unknown, fallback: string) =>
  typeof v === "string" && Number.isFinite(Date.parse(v))
    ? new Date(v).toISOString()
    : fallback;
export function normalizeQuo(
  kind: "call" | "message",
  r: any,
  context: any = {},
  eventType = "",
  occurred = new Date().toISOString(),
): QuoEvent {
  const id = r.callId || r.id;
  if (typeof id !== "string" || !/^AC[a-zA-Z0-9_-]{1,145}$/.test(id))
    throw Error("Invalid Quo resource identifier");
  let external: string[] = [];
  if (kind === "call")
    external =
      context.participants?.external ||
      (r.participants || [])
        .filter((p: any) => p.actorId == null)
        .map((p: any) => p.phoneNumber);
  else
    external =
      r.direction === "incoming"
        ? [context.senderIdentifier || r.from]
        : context.recipientIdentifiers || r.to || [];
  external = [...new Set(external.map((p) => phone(p)).filter(Boolean))];
  const payload: Record<string, unknown> = {};
  if (r.summary)
    payload.summary = Array.isArray(r.summary)
      ? {
          status: r.processingStatus,
          summary: r.summary,
          nextSteps: r.nextSteps || [],
        }
      : r.summary;
  if (eventType === "call.summary.completed")
    payload.summary = {
      status: r.processingStatus,
      summary: r.summary || [],
      nextSteps: r.nextSteps || [],
    };
  if (r.dialogue)
    payload.transcripts = [
      { status: r.processingStatus, dialogue: r.dialogue },
    ];
  if (r.recordings)
    payload.recordings = r.recordings.map((p: any) => ({
      id: p.id,
      duration: p.duration,
      startTime: p.startTime,
    }));
  if (r.voicemail)
    payload.voicemail = {
      status: r.voicemail.status,
      transcript: r.voicemail.transcript,
    };
  if (eventType === "call.voicemail.completed")
    payload.voicemail = { status: "completed", transcript: r.transcript };
  if (r.media?.length) payload.hasMedia = true;
  // Signed media URLs stay out of the client data and the database; resolve them
  // through the authenticated recording route when the user requests playback.
  const status =
    eventType === "call.missed"
      ? "missed"
      : r.status ||
        (eventType === "call.answered"
          ? "in-progress"
          : eventType === "call.ringing"
            ? "ringing"
            : "");
  return {
    id,
    kind,
    phone: external.length === 1 ? external[0] : "",
    phone_number_id: context.phoneNumberId || r.phoneNumberId || "",
    user_id:
      r.answeredBy ||
      r.initiatedBy ||
      r.answeredByUserId ||
      context.userId ||
      r.actorId ||
      r.userId ||
      "",
    direction: r.direction || "",
    status,
    connected: !!r.answeredAt || status === "answered",
    duration: Math.max(0, Math.floor(Number(r.duration) || 0)),
    content: String(r.text || "").slice(0, 20000),
    occurred_at: timestamp(r.createdAt, occurred),
    source_updated_at: timestamp(r.updatedAt, occurred),
    payload,
  };
}
export function verifyQuo(
  raw: string,
  headers: Headers,
  key: string,
  now = Date.now(),
) {
  const id = headers.get("webhook-id"),
    timestamp = headers.get("webhook-timestamp"),
    signatures = headers.get("webhook-signature");
  if (
    !id ||
    !timestamp ||
    !signatures ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const bytes = Buffer.from(key.replace(/^whsec_/, ""), "base64");
  if (!bytes.length) return false;
  const expected = createHmac("sha256", bytes)
    .update(`${id}.${timestamp}.${raw}`)
    .digest();
  return signatures.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    const supplied = Buffer.from(sig, "base64");
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  });
}
export async function quoRequest(
  path: string,
  options: { method?: string; body?: unknown; legacy?: boolean } = {},
  fetcher = fetch,
) {
  const key = process.env.QUO_API_KEY;
  if (!key)
    throw Error(
      "Quo is not connected. Ask an administrator to configure the integration.",
    );
  if (!path.startsWith("/") || path.startsWith("//"))
    throw Error("Invalid Quo path");
  const r = await fetcher("https://api.quo.com" + path, {
    method: options.method || "GET",
    headers: {
      Authorization: key,
      ...(!options.legacy ? { "Quo-Api-Version": QUO_VERSION } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    // Never echo provider response bodies or credentials into browser errors.
    throw Error(
      r.status === 429
        ? "Quo rate limit reached. Try again shortly."
        : `Quo request failed (${r.status}). Check account permissions and plan availability.`,
    );
  }
  if (r.status === 204) return {};
  return r.json();
}
export async function quoPages(
  path: string,
  legacy = false,
  maxPages = 100,
  fetcher = fetch,
) {
  const rows: any[] = [];
  let cursor = "";
  const seen = new Set<string>();
  for (let n = 0; n < maxPages; n++) {
    const u = new URL(path, "https://api.quo.com");
    u.searchParams.set(legacy ? "maxResults" : "limit", "50");
    if (cursor) u.searchParams.set(legacy ? "pageToken" : "after", cursor);
    const page = await quoRequest(u.pathname + u.search, { legacy }, fetcher);
    if (!Array.isArray(page.data)) throw Error("Unexpected Quo response");
    rows.push(...page.data);
    cursor = (legacy ? page.nextPageToken : page.nextCursor) || "";
    if (!cursor) return rows;
    if (seen.has(cursor)) throw Error("Invalid Quo pagination");
    seen.add(cursor);
  }
  throw Error("Quo page limit reached. Use a smaller date range.");
}
export function callMetrics(rows: QuoEvent[]) {
  const calls = rows.filter((e) => e.kind === "call"),
    terminal = calls.filter(
      (e) =>
        !["queued", "initiated", "ringing", "in-progress", ""].includes(
          e.status,
        ),
    );
  const answered = terminal.filter((e) => e.connected),
    missed = terminal.filter((e) => e.direction === "incoming" && !e.connected),
    seconds = answered.reduce((n, e) => n + e.duration, 0);
  const groups = (key: (e: QuoEvent) => string, items: QuoEvent[]) =>
    Object.entries(
      items.reduce(
        (m, e) => {
          const k = key(e);
          m[k] = (m[k] || 0) + 1;
          return m;
        },
        {} as Record<string, number>,
      ),
    ).map(([label, value]) => ({ label, value }));
  return {
    calls: calls.length,
    answered: answered.length,
    terminal: terminal.length,
    missed: missed.length,
    seconds,
    average: answered.length ? seconds / answered.length : 0,
    daily: groups((e) => e.occurred_at.slice(0, 10), calls).sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    agents: groups((e) => e.user_id || "Unmapped", calls),
    statuses: groups((e) => e.status || "Unknown", calls),
    directions: groups((e) => e.direction || "Unknown", calls),
    messages: rows.filter((e) => e.kind === "message").length,
  };
}
