import { authorized, localDemo } from "@/lib/auth";
import { json, failure } from "@/lib/http";
import { date } from "@/lib/validation";
import { demoReport } from "@/lib/demo";
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams,
      from = q.get("from")?.trim() || null,
      to = q.get("to")?.trim() || null;
    if (from) date.parse(from);
    if (to) date.parse(to);
    if (from && to && from > to)
      throw new Error("From date must be before To date");
    if (localDemo()) return json(demoReport(from, to));
    const { db } = await authorized();
    const { data, error } = await db.rpc("crm_report", {
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(error.message);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
