import { authorized, localDemo, HttpError } from "@/lib/auth";
import { json, failure, sameOrigin, body } from "@/lib/http";
import { previewCsv } from "@/lib/import";
import { z } from "zod";
import type { Member } from "@/lib/types";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (localDemo())
      throw new HttpError("Connect your database before importing.", 403);
    const { db } = await authorized(true);
    const input = z
      .object({
        csv: z.string().max(2000000),
        fallback: z.string(),
        source: z.string(),
        dateFormat: z.enum(["ISO", "MDY", "DMY"]).default("ISO"),
        commit: z.boolean().default(false),
      })
      .parse(await body(request, 2100000));
    const { data: members, error } = await db.from("team_members").select("*");
    if (error) throw new Error(error.message);
    const preview = previewCsv(
      input.csv,
      members as Member[],
      input.fallback,
      input.source,
      input.dateFormat,
    );
    if (!input.commit)
      return json({ ...preview, rows: preview.rows.slice(0, 10) });
    if (preview.errors.length)
      throw new Error(
        "Fix every import error before importing. No data was written.",
      );
    if (!preview.rows.length) throw new Error("No lead rows found");
    const { data, error: writeError } = await db.rpc("import_leads", {
      p_rows: preview.rows,
    });
    if (writeError) throw new Error(writeError.message);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
