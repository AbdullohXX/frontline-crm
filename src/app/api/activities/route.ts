import { authorized, localDemo, HttpError } from "@/lib/auth";
import { json, failure, sameOrigin, body } from "@/lib/http";
import { activitySchema } from "@/lib/validation";
import { demoActivities } from "@/lib/demo";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const id = z.uuid().parse(new URL(request.url).searchParams.get("lead"));
    if (localDemo())
      return json(demoActivities.filter((a) => a.lead_id === id));
    const { db } = await authorized();
    const { data, error } = await db
      .from("activities")
      .select(
        "id,lead_id,actor_email,actor_name,action,details,outcome,from_stage,to_stage,deal_value,next_action,next_follow_up,created_at",
      )
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo())
      throw new HttpError(
        "Preview is read-only. Connect Supabase to log activities.",
        403,
      );
    const { db } = await authorized();
    const p = activitySchema.parse(await body(request));
    const { data, error } = await db.rpc("record_activity", { p }).single();
    if (error) throw new Error(error.message);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
