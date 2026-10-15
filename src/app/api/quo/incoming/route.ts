import { authorized, localDemo } from "@/lib/auth";
import { failure, json } from "@/lib/http";
import { isLiveIncomingCall } from "@/lib/incoming-call";

export async function GET() {
  try {
    if (localDemo()) return json({ calls: [] });
    const { db } = await authorized();
    const now = Date.now();
    const { data, error } = await db
      .from("quo_events")
      .select("id,phone,lead_id,status,occurred_at")
      .eq("kind", "call")
      .eq("direction", "incoming")
      .in("status", ["ringing", "in-progress", "answered"])
      .gte("occurred_at", new Date(now - 120000).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(20);
    if (error)
      throw Error("Incoming call updates are temporarily unavailable.");
    return json({
      calls: (data || []).filter((c) => isLiveIncomingCall(c, now)),
    });
  } catch (e) {
    return failure(e);
  }
}
