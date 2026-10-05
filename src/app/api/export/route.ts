import { authorized } from "@/lib/auth";
import { failure } from "@/lib/http";
import Papa from "papaparse";
export async function GET() {
  try {
    const { db } = await authorized();
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("leads")
        .select("*")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
      if (rows.length >= 50000)
        throw new Error("Export exceeds 50,000 rows. Use a database export.");
    }
    const csv = Papa.unparse(rows, { escapeFormulae: true });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": 'attachment; filename="frontline-leads.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
