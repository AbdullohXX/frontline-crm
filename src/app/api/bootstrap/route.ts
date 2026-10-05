import { authorized, localDemo } from "@/lib/auth";
import { demoBootstrap } from "@/lib/demo";
import { json, failure } from "@/lib/http";
export async function GET() {
  try {
    if (localDemo()) return json(demoBootstrap);
    const { db, member } = await authorized();
    const [{ data: settings, error: s }, { data: members, error: m }] =
      await Promise.all([
        db.from("crm_settings").select("*").single(),
        db.from("team_members").select("*").order("display_name"),
      ]);
    if (s || m)
      throw new Error(
        "Database schema unavailable. Apply the SQL migration first.",
      );
    const timeZone = settings.time_zone;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (t: string) => parts.find((p) => p.type === t)!.value;
    return json({
      member,
      members,
      timeZone,
      today: `${part("year")}-${part("month")}-${part("day")}`,
      demo: false,
      workAddress: settings.work_address,
      teamPhone: settings.team_phone,
    });
  } catch (e) {
    return failure(e);
  }
}
