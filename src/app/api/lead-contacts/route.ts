import { authorized, localDemo, HttpError } from "@/lib/auth";
import { body, json, failure, sameOrigin } from "@/lib/http";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const lead = z.uuid().parse(new URL(request.url).searchParams.get("lead"));
    if (localDemo()) return json({ contacts: [] });
    const { db } = await authorized();
    const { data, error } = await db
      .from("lead_contacts")
      .select("*")
      .eq("lead_id", lead)
      .order("created_at")
      .order("id");
    if (error) throw Error("Could not load additional contacts");
    return json({ contacts: data });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo()) throw new HttpError("Preview is read-only", 403);
    const { db } = await authorized();
    const p = z
      .object({
        action: z.enum(["save", "archive", "restore"]),
        lead_id: z.uuid(),
        id: z.uuid().optional(),
        version: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        label: z.string().max(100).optional(),
        email: z.union([z.email(), z.literal("")]).optional(),
        phone: z
          .union([z.string().regex(/^\+[1-9][0-9]{6,14}$/), z.literal("")])
          .optional(),
      })
      .parse(await body(request));
    const { data, error } = await db.rpc("save_lead_contact", { p });
    if (error) throw Error(error.message);
    return json({ contact: data });
  } catch (e) {
    return failure(e);
  }
}
