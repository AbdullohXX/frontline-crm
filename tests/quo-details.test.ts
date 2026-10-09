import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeQuoDetails } from "../src/lib/quo-details.js";

test("call detail fetch preserves completed webhook summary when response omits it", () => {
  const summary = { status: "completed", summary: ["Customer requested a quote"], nextSteps: ["Send quote"] };
  for (const incoming of [{ recordings: [] }, { summary: null }, { summary: { summary: [] } }]) {
    assert.deepEqual(mergeQuoDetails({ summary }, incoming).summary, summary);
  }
});
test("new webhook summary replaces old content and empty refresh preserves transcript", () => {
  const fresh = { summary: ["Updated summary"] };
  const previous = { summary: { summary: ["Old"] }, transcripts: [{ dialogue: ["Hello"] }] };
  const result = mergeQuoDetails(previous, { summary: fresh, transcripts: [], recordings: [{ id: "new" }] });
  assert.deepEqual(result.summary, fresh);
  assert.deepEqual(result.transcripts, previous.transcripts);
  assert.deepEqual(result.recordings, [{ id: "new" }]);
});

test("Quo call details request uses separate include values for summary and voicemail", async () => {
  const { quoCallDetailsPath } = await import("../src/lib/quo-details.js");
  const url = new URL(quoCallDetailsPath("ACtest"), "https://api.quo.com");
  assert.equal(url.pathname, "/calls/ACtest");
  assert.deepEqual(url.searchParams.getAll("include"), ["summary", "voicemail"]);
});
