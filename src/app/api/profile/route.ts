import { authorized, localDemo, HttpError } from "@/lib/auth";
import { sameOrigin, body, json, failure } from "@/lib/http";
import { z } from "zod";
export async function POST(r: Request) {
  try {
    sameOrigin(r);
    if (localDemo()) throw new HttpError("Preview is read-only", 403);
    const { db } = await authorized();
    const p = z
      .object({
        avatar_color: z.union([
          z.string().regex(/^#[0-9a-fA-F]{6}$/),
          z.literal(""),
        ]),
        avatar_image: z.union([
          z
            .string()
            .max(30000)
            .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/),
          z.literal(""),
        ]),
      })
      .parse(await body(r));
    const { data, error } = await db.rpc("save_profile", { p });
    if (error) throw Error("Could not save profile");
    return json({ member: data });
  } catch (e) {
    return failure(e);
  }
}
