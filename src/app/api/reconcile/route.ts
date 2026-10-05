import { authorized } from "@/lib/auth";
import { body, failure, json, sameOrigin } from "@/lib/http";
import { previewCsv } from "@/lib/import";
import { reconcileRows } from "@/lib/reconcile";
import type { Lead, Member } from "@/lib/types";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { db } = await authorized(true);
    const input = z
      .object({
        csv: z.string().max(2000000),
        dateFormat: z.enum(["ISO", "MDY", "DMY"]).default("ISO"),
      })
      .parse(await body(request, 2100000));
    const { data: members, error } = await db.from("team_members").select("*");
    if (error) throw new Error(error.message);
    const preview = previewCsv(
      input.csv,
      members as Member[],
      "",
      "comparison",
      input.dateFormat,
    );
    const leads: Lead[] = [];
    for (let offset = 0; offset <= 50000; offset += 1000) {
      const { data, error } = await db
        .from("leads")
        .select("*")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      leads.push(...data);
      if (leads.length > 50000)
        throw new Error("Comparison exceeds 50,000 current leads.");
      if (data.length < 1000) break;
    }
    return json({
      ...reconcileRows(preview.rows, leads),
      sourceRows: preview.total,
      errors: preview.errors,
      warnings: preview.warnings,
    });
  } catch (e) {
    return failure(e);
  }
}
