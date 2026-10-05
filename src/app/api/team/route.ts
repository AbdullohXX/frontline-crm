import { authorized, localDemo, HttpError } from "@/lib/auth";
import { json, failure, sameOrigin, body } from "@/lib/http";
import { memberSchema } from "@/lib/validation";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo()) throw new HttpError("Preview is read-only.", 403);
    const { db } = await authorized(true);
    const p = memberSchema.parse(await body(request));
    const { error } = await db.rpc("save_member", { p });
    if (error) throw new Error(error.message);
    return json({ success: true });
  } catch (e) {
    return failure(e);
  }
}
