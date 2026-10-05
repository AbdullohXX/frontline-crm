import { authorized, localDemo, HttpError } from "@/lib/auth";
import { body, failure, json, sameOrigin } from "@/lib/http";
import { z } from "zod";
import { STAGES } from "@/lib/types";
import { WORK_STATUSES } from "@/lib/workflow";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo())
      throw new HttpError(
        "Preview is read-only. Connect Supabase to save changes.",
        403,
      );
    const { db } = await authorized();
    const p = z
      .object({
        action: z.enum(["stage", "work_status", "archive", "restore"]),
        items: z
          .array(
            z.object({ id: z.uuid(), version: z.number().int().positive() }),
          )
          .min(1)
          .max(100),
        stage: z.enum(STAGES).optional(),
        work_status: z.enum(WORK_STATUSES).optional(),
        loss_reason: z.string().trim().max(500).optional(),
      })
      .parse(await body(request));
    const { data, error } = await db.rpc("change_leads", { p });
    if (error) throw new Error(error.message);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
