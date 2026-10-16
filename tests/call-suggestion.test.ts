import { test } from "node:test";
import assert from "node:assert/strict";
import {
  suggestCall,
  tomorrowInZone,
  nextFollowup,
} from "../src/lib/call-suggestion.js";
test("Call summary recommendations remain review-only and do not confuse answered with human contact", () => {
  const date = "2026-10-18";
  const s = suggestCall(
    {
      status: "completed",
      payload: {
        summary: { summary: ["Left a voicemail asking for a call back."] },
      },
    },
    "Contacted",
    date,
  );
  assert.equal(s.disposition, "Voicemail");
  assert.equal(s.stage, "Follow-up 1");
  assert.equal(s.next_follow_up, date);
  assert.equal(s.requires_confirmation, true);
  const unknown = suggestCall(
    { status: "completed", connected: true, payload: {} },
    "New",
    date,
  );
  assert.equal(unknown.disposition, "");
  assert.equal(unknown.stage, "");
  assert.equal(
    suggestCall(
      {
        payload: {
          summary: {
            summary: ["They discussed scheduling a meeting in the future."],
          },
        },
      },
      "New",
      date,
    ).stage,
    "",
  );
  assert.equal(
    suggestCall(
      {
        payload: {
          summary: { summary: ["A meeting was scheduled for Tuesday."] },
        },
      },
      "New",
      date,
    ).stage,
    "Meeting Booked",
  );
  assert.equal(nextFollowup("Follow-up 1"), "Follow-up 2");
  assert.equal(nextFollowup("Follow-up 2"), "Follow-up 3");
  assert.equal(
    tomorrowInZone("America/New_York", new Date("2026-11-01T23:00:00Z")),
    "2026-11-02",
  );
});
