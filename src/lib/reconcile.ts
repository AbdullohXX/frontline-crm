import type { ImportRow } from "./import";
import type { Lead } from "./types";
export function reconcileRows(incoming: ImportRow[], existing: Lead[]) {
  const result: {
    company: string;
    legacy_id: string;
    outcome: "New" | "Changed" | "Unchanged" | "Ambiguous";
    fields: string[];
  }[] = [];
  const normalize = (v: unknown) =>
    String(v ?? "")
      .trim()
      .toLowerCase();
  const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const compared = [
    "company",
    "contact",
    "job_title",
    "email",
    "phone",
    "country",
    "industry",
    "source",
    "score",
    "stage",
    "status",
    "value",
    "priority",
    "notes",
    "owner_email",
    "next_follow_up",
    "work_status",
  ] as const;
  const matched = new Set<string>();
  for (const row of incoming) {
    let matches = row.legacy_id
      ? existing.filter(
          (l) => l.legacy_id === row.legacy_id || l.id === row.legacy_id,
        )
      : [];
    if (!matches.length)
      matches = existing.filter(
        (l) =>
          normalize(l.company) === normalize(row.company) &&
          ((row.email && normalize(row.email) === normalize(l.email)) ||
            (row.phone && digits(row.phone) === digits(l.phone)) ||
            (!row.email &&
              !row.phone &&
              normalize(l.contact) === normalize(row.contact))),
      );
    const match = matches.length === 1 ? matches[0] : null;
    if (match) matched.add(match.id);
    const fields = match
      ? compared.filter(
          (key) =>
            normalize(row[key]) !==
            normalize(
              key === "work_status" ? match[key] || "None" : match[key],
            ),
        )
      : [];
    result.push({
      company: row.company,
      legacy_id: row.legacy_id,
      outcome:
        matches.length > 1
          ? "Ambiguous"
          : !match
            ? "New"
            : fields.length
              ? "Changed"
              : "Unchanged",
      fields,
    });
  }
  return {
    sourceRows: incoming.length,
    currentRows: existing.length,
    newRows: result.filter((r) => r.outcome === "New").length,
    changedRows: result.filter((r) => r.outcome === "Changed").length,
    unchangedRows: result.filter((r) => r.outcome === "Unchanged").length,
    ambiguousRows: result.filter((r) => r.outcome === "Ambiguous").length,
    currentNotMatched: existing.filter((l) => !matched.has(l.id)).length,
    rows: result,
  };
}
