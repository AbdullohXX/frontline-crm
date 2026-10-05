import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callingInfo,
  leadZone,
  workStatusFromLegacy,
} from "../src/lib/workflow.js";
test("Calling windows use DST, weekdays and explicit zones without guessing split states", () => {
  assert.equal(leadZone({ country: "US / FL" }), "");
  assert.equal(leadZone({ country: "US / NY" }), "America/New_York");
  assert.equal(
    callingInfo({ country: "US / NY" }, new Date("2026-01-05T14:00:00Z")).open,
    true,
  );
  assert.equal(
    callingInfo({ country: "US / NY" }, new Date("2026-07-06T13:00:00Z")).open,
    true,
  );
  assert.equal(
    callingInfo({ country: "US / NY" }, new Date("2026-07-06T21:00:00Z")).open,
    false,
  );
  assert.equal(
    callingInfo({ country: "US / NY" }, new Date("2026-07-04T15:00:00Z")).open,
    false,
  );
  assert.equal(
    callingInfo({ country: "US / AZ" }, new Date("2026-07-06T15:00:00Z")).open,
    false,
  );
  assert.equal(workStatusFromLegacy("AI voicemail"), "AI voicemail");
});
