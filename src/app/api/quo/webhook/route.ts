import { verifyQuo, normalizeQuo } from "@/lib/quo";
import { ingestEvents } from "@/lib/quo-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const key = process.env.QUO_WEBHOOK_KEY;
  if (!key)
    return Response.json({ error: "Webhook not configured" }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 1000000)
    return new Response(null, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1000000)
    return new Response(null, { status: 413 });
  if (!verifyQuo(raw, request.headers, key))
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  try {
    const event = JSON.parse(raw);
    if (
      !event.id ||
      event.apiVersion !== "2026-03-30" ||
      !event.data?.resource ||
      !event.data?.context
    )
      return Response.json({ error: "Unsupported event" }, { status: 400 });
    if (!/^(call|message)\./.test(event.type))
      return Response.json({ ignored: true });
    // A single durable database transaction acknowledges within Quo's deadline;
    // recordings/transcripts are resolved separately, without blocking delivery.
    const normalized = normalizeQuo(
      event.type.startsWith("call.") ? "call" : "message",
      event.data.resource,
      event.data.context,
      event.type,
      event.createdAt,
    );
    await ingestEvents([normalized], event.id);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Could not persist event; retry delivery" },
      { status: 503 },
    );
  }
}
