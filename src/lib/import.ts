import Papa from "papaparse";
import { leadSchema, date } from "./validation";
import { STAGES, type Member } from "./types";
import { workStatusFromLegacy } from "./workflow";
export type ImportRow = ReturnType<typeof leadSchema.parse> & {
  legacy_id: string;
  import_key: string;
  legacy_stage: string;
  legacy_owner: string;
  original_created_date: string | null;
  original_creator: string;
};
export type ImportPreview = {
  rows: ImportRow[];
  errors: string[];
  warnings: string[];
  total: number;
};
const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "—" ? "" : s;
};
function canonical(v: string) {
  const known = STAGES.find((s) => s.toLowerCase() === v.toLowerCase());
  if (known) return known;
  if (
    [
      "email/sent",
      "email sent",
      "ai voicemail",
      "follow-up",
      "follow up",
    ].includes(v.toLowerCase())
  )
    return "Contacted";
  if (v.toLowerCase() === "not ready") return "Nurture";
  return "New";
}
function parsedDate(v: unknown, format: "ISO" | "MDY" | "DMY") {
  const value = clean(v);
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(value))
    return date.parse(value.slice(0, 10));
  const match = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (!match || format === "ISO")
    throw new Error(
      "Date must be YYYY-MM-DD, or select the source CSV date format.",
    );
  const month = format === "MDY" ? match[1] : match[2],
    day = format === "MDY" ? match[2] : match[1];
  return date.parse(
    `${match[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
  );
}
// The legacy CRM's first 18 columns, in their established A–R order.
const columns = [
  "id",
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
  "next_follow_up",
  "value",
  "priority",
  "notes",
  "legacy_owner",
  "original_created_date",
];
const aliases: Record<string, string> = {
  "lead id": "id",
  id: "id",
  company: "company",
  "company name": "company",
  contact: "contact",
  "contact name": "contact",
  "job title": "job_title",
  email: "email",
  phone: "phone",
  country: "country",
  industry: "industry",
  source: "source",
  score: "score",
  stage: "stage",
  status: "status",
  "next follow-up": "next_follow_up",
  "next follow up": "next_follow_up",
  "next follow-up date": "next_follow_up",
  value: "value",
  "deal value": "value",
  priority: "priority",
  notes: "notes",
  "created by": "legacy_owner",
  "assigned to": "legacy_owner",
  owner: "legacy_owner",
  "created at": "original_created_date",
  "date created": "original_created_date",
  "original creator": "original_creator",
  "owner email": "owner_email",
  "next action": "next_action",
  "loss reason": "loss_reason",
};
export function previewCsv(
  csv: string,
  members: Member[],
  fallback: string,
  source: string,
  dateFormat: "ISO" | "MDY" | "DMY" = "ISO",
): ImportPreview {
  const out: ImportPreview = { rows: [], errors: [], warnings: [], total: 0 };
  if (!/^[\w-]{1,60}$/.test(source))
    throw new Error(
      "Source name: use 1–60 letters, numbers, underscores or hyphens.",
    );
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: "greedy" });
  if (parsed.errors.length)
    throw new Error("CSV could not be parsed: " + parsed.errors[0].message);
  if (parsed.data.length > 5010)
    throw new Error("Import at most 5000 leads per file.");
  let header = parsed.data.findIndex(
    (r) =>
      r.some((v) =>
        ["company", "company name"].includes(clean(v).toLowerCase()),
      ) &&
      r.some((v) =>
        ["id", "lead id", "contact", "contact name"].includes(
          clean(v).toLowerCase(),
        ),
      ),
  );
  if (header < 0)
    throw new Error(
      "Could not find the CRM header row. Use a canonical CSV template or a Sheets CSV containing the original A–R columns.",
    );
  const fields = parsed.data[header].map(
    (v) =>
      aliases[clean(v).toLowerCase()] ||
      clean(v).toLowerCase().replaceAll(" ", "_"),
  );
  // Full sheet exports may have decorative rows above row 8. Preserve the legacy column contract.
  const legacy =
    header === 7 ||
    (fields.length >= 18 && fields[1] === "company" && fields[2] === "contact");
  const used = new Set<string>();
  parsed.data.slice(header + 1).forEach((values, i) => {
    if (values.every((v) => !clean(v))) return;
    out.total++;
    const rowNumber = header + i + 2;
    try {
      const row: Record<string, string> = {};
      values.forEach((v, j) => {
        row[legacy ? columns[j] || fields[j] : fields[j]] = clean(v);
      });
      // CRM v2 has owner email in AA and next action in X, after the unchanged A–R columns.
      if (legacy && values.length >= 27) {
        row.owner_email = clean(values[26]);
        row.next_action = clean(values[23]);
        row.loss_reason = clean(values[21]);
        row.original_creator = clean(values[18]);
      }
      const owner =
        members.find(
          (m) =>
            m.active &&
            [m.email, m.display_name.toLowerCase(), ...m.aliases].includes(
              (row.owner_email || row.legacy_owner || "").toLowerCase(),
            ),
        )?.email || fallback;
      if (!members.some((m) => m.active && m.email === owner))
        throw new Error(
          "Owner is not mapped. Add team aliases or explicitly choose a fallback owner.",
        );
      const oldstage = row.stage || "New",
        stage = canonical(oldstage),
        key = source + ":" + (row.id || "row-" + rowNumber);
      if (used.has(key)) throw new Error("Duplicate lead ID in this file");
      used.add(key);
      const next = parsedDate(row.next_follow_up, dateFormat),
        value = Number((row.value || "0").replace(/[$,]/g, "")),
        score = row.score ? Number(row.score) : null;
      const input = leadSchema.parse({
        company: row.company,
        contact: row.contact || "",
        job_title: row.job_title || "",
        email: row.email || "",
        phone: row.phone || "",
        country: row.country || "",
        industry: row.industry || "",
        source: row.source || "",
        score,
        stage,
        work_status: row.work_status || workStatusFromLegacy(oldstage),
        time_zone: row.time_zone || "",
        status: row.status || "Active",
        value,
        priority: row.priority || "Medium",
        notes: row.notes || "",
        owner_email: owner,
        next_action: next ? row.next_action || "Follow up with contact" : "",
        next_follow_up: next,
        loss_reason:
          stage === "Lost"
            ? row.loss_reason || "Legacy: loss reason not recorded"
            : "",
      });
      if (stage !== oldstage)
        out.warnings.push(
          `Row ${rowNumber}: “${oldstage}” maps to ${stage}; original stage is preserved.`,
        );
      if (
        !row.owner_email &&
        !members.some((m) =>
          [m.email, m.display_name.toLowerCase(), ...m.aliases].includes(
            (row.legacy_owner || "").toLowerCase(),
          ),
        )
      )
        out.warnings.push(
          `Row ${rowNumber}: explicitly selected fallback owner ${owner}.`,
        );
      out.rows.push({
        ...input,
        legacy_id: row.id || "",
        import_key: key,
        legacy_stage: oldstage,
        legacy_owner: row.legacy_owner || "",
        original_created_date: parsedDate(
          row.original_created_date,
          dateFormat,
        ),
        original_creator: row.original_creator || "",
      });
    } catch (e) {
      out.errors.push(
        `Row ${rowNumber}: ${e instanceof Error ? e.message : "Invalid values"}`,
      );
    }
  });
  return out;
}
