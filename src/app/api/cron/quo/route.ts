import { timingSafeEqual } from "node:crypto";
import { syncQuo, syncQueuedContacts } from "@/lib/quo-server";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const expected = Buffer.from("Bearer " + (process.env.CRON_SECRET || "")),
    supplied = Buffer.from(request.headers.get("authorization") || "");
  if (
    !process.env.CRON_SECRET ||
    supplied.length !== expected.length ||
    !timingSafeEqual(expected, supplied)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({
      ...(await syncQuo(undefined, 2)),
      contacts: await syncQueuedContacts(),
    });
  } catch {
    return Response.json(
      { error: "Quo sync failed; existing records retained" },
      { status: 502 },
    );
  }
}
