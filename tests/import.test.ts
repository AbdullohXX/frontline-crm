import { test } from "node:test";
import assert from "node:assert/strict";
import { previewCsv } from "../src/lib/import";
import { leadSchema, date } from "../src/lib/validation";
const members = [
  {
    email: "agent@frontline-x.com",
    display_name: "Agent",
    role: "Agent" as const,
    active: true,
    aliases: ["lucy"],
  },
];
test("Ambiguous CSV dates require an explicit format", () => {
  const csv =
    "id,company,stage,owner_email,next_follow_up\n1,One,New,agent@frontline-x.com,02/03/2026";
  assert.equal(previewCsv(csv, members, "", "dates").errors.length, 1);
  assert.equal(
    previewCsv(csv, members, "", "dates", "MDY").rows[0].next_follow_up,
    "2026-02-03",
  );
  assert.equal(
    previewCsv(csv, members, "", "dates", "DMY").rows[0].next_follow_up,
    "2026-03-02",
  );
});
test("CSV quotes, score zero, owner aliases and legacy stages are preserved", () => {
  const csv =
    'id,company,contact,job_title,email,phone,country,industry,source,score,stage,status,next_follow_up,value,priority,notes,legacy_owner,original_created_date\n1,"Company, Inc",Lucy,,a@example.test,+14155550123,,,,0,AI Voicemail,Active,2026-10-02,1000,High,"First line\nSecond line",lucy,2025-01-01';
  const p = previewCsv(csv, members, "", "original");
  assert.equal(p.errors.length, 0);
  assert.equal(p.rows[0].score, 0);
  assert.equal(p.rows[0].company, "Company, Inc");
  assert.equal(p.rows[0].stage, "Contacted");
  assert.equal(p.rows[0].legacy_stage, "AI Voicemail");
  assert.equal(p.rows[0].owner_email, members[0].email);
  assert.equal(p.rows[0].notes, "First line\nSecond line");
});
test("Unknown owners and duplicate IDs block import; dates do not silently normalize", () => {
  const csv = "id,company,stage,owner_email\n1,One,New,unknown@frontline-x.com";
  assert.equal(previewCsv(csv, members, "", "source").errors.length, 1);
  assert.equal(
    previewCsv(csv, members, members[0].email, "source").errors.length,
    0,
  );
  assert.equal(
    previewCsv(
      "id,company,stage,owner_email\n1,One,New,agent@frontline-x.com\n1,Two,New,agent@frontline-x.com",
      members,
      "",
      "source",
    ).errors.length,
    1,
  );
  assert.throws(() => date.parse("2026-02-30"));
  assert.throws(() =>
    leadSchema.parse({
      company: "Company",
      owner_email: members[0].email,
      stage: "Lost",
    }),
  );
});
