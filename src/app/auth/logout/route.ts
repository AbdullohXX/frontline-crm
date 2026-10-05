import { database } from "@/lib/supabase/server";
import { json, failure, sameOrigin } from "@/lib/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = await database();
    await db.auth.signOut();
    return json({ success: true });
  } catch (e) {
    return failure(e);
  }
}
