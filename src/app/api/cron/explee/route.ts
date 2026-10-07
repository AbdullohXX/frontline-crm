import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { EXPLEE_PROJECT_ID, fetchHotLeads } from "@/lib/explee";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  if (
    !secret ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.EXPLEE_API_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key || !url || !publicKey)
    return Response.json({ error: "Sync is not configured" }, { status: 503 });
  // Dedicated, hash-verified token permits only the ingestion RPC, not general database access.
  const db = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let lease: string | undefined;
  async function rpc(operation: string, payload: unknown = {}) {
    const { data, error } = await db.rpc("explee_sync", {
      token: secret,
      operation,
      payload,
    });
    if (error) throw new Error("Explee database operation failed");
    return data;
  }
  try {
    const state = await rpc("acquire");
    if (!state) return Response.json({ skipped: "Already running" });
    lease = state.lease;
    const leads = await fetchHotLeads(key, state.cursor);
    const result = await rpc("commit", {
      lease,
      project_id: EXPLEE_PROJECT_ID,
      leads,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    if (lease) await rpc("release", { lease }).catch(() => {});
    console.error("Explee sync failed; cursor retained");
    return Response.json(
      { error: "Sync failed; safe to retry" },
      { status: 502 },
    );
  }
}
