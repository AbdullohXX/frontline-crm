import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveIncomingCall } from "../src/lib/incoming-call.js";

test("screen pop accepts only recent live calls, not stale or completed calls", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const call = {
    id: "ACtest",
    phone: "13075550100",
    lead_id: null,
    status: "ringing",
    occurred_at: "2026-10-16T11:59:45Z",
  };
  assert.equal(isLiveIncomingCall(call, now), true);
  assert.equal(
    isLiveIncomingCall({ ...call, status: "in-progress" }, now),
    true,
  );
  for (const status of ["completed", "missed", "failed", "busy", "canceled"])
    assert.equal(isLiveIncomingCall({ ...call, status }, now), false);
  for (const occurred_at of [
    "invalid",
    "2026-10-16T11:57:00Z",
    "2026-10-16T12:01:00Z",
  ])
    assert.equal(isLiveIncomingCall({ ...call, occurred_at }, now), false);
});
