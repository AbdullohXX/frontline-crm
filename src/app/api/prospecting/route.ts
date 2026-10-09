import { authorized, localDemo } from "@/lib/auth";
import { sameOrigin, json, failure } from "@/lib/http";
import { GET as sync } from "@/app/api/cron/explee/route";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo())
      return json({
        preview: true,
        message: "Preview only. No leads imported.",
      });
    await authorized(true);
    if (!process.env.CRON_SECRET)
      return json({ error: "Prospecting sync is not configured" }, 503);
    return sync(
      new Request(new URL("/api/cron/explee", request.url), {
        headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
