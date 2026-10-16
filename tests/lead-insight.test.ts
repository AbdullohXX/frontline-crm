import { test } from "node:test";
import assert from "node:assert/strict";
import { outreachInsight } from "../src/lib/lead-insight.js";
import type { Lead } from "../src/lib/types.js";
const lead = {
  stage: "Contacted",
  phone: "+13075550111",
  email: "buyer@example.test",
  archived_at: null,
  next_follow_up: null,
  next_action: "",
  loss_reason: "",
} as Lead;
test("lead insights require both verified outreach channels and respect scheduled/closed stages", () => {
  assert.equal(
    outreachInsight(lead, "2026-10-16", false, false).title,
    "Call and email this lead",
  );
  assert.equal(
    outreachInsight(lead, "2026-10-16", true, false).title,
    "Send and verify the email",
  );
  assert.equal(
    outreachInsight(lead, "2026-10-16", false, true).title,
    "Make the call",
  );
  assert.equal(
    outreachInsight(lead, "2026-10-16", true, true).tone,
    "complete",
  );
  assert.equal(
    outreachInsight(
      { ...lead, next_follow_up: "2026-10-17" },
      "2026-10-16",
      false,
      false,
    ).tone,
    "scheduled",
  );
  assert.equal(
    outreachInsight({ ...lead, stage: "Won" }, "2026-10-16", false, false)
      .title,
    "Prepare the handover",
  );
  assert.equal(
    outreachInsight(
      { ...lead, stage: "Meeting Booked" },
      "2026-10-16",
      false,
      false,
    ).title,
    "Prepare for the meeting",
  );
});
