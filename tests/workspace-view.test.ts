import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stateFromUrl,
  stateToUrl,
  viewFromUrl,
  viewState,
} from "../src/lib/workspace-view.js";
test("saved workspace filters round-trip without losing pages or encoding values", () => {
  const state = viewState({
    search: "Acme & Sons",
    scope: "mine",
    stage: "Meeting Booked",
    page: 3,
    owner: "agent@frontline-x.com",
    work: "Follow-up",
    density: "compact",
    date: "2026-10-16",
    archived: true,
  });
  const q = new URL(
    stateToUrl("leads", state, "00000000-0000-4000-8000-000000000001"),
    "https://crm.example",
  ).searchParams;
  assert.equal(viewFromUrl(q), "leads");
  assert.deepEqual(stateFromUrl(q), state);
  assert.equal(q.get("lead"), "00000000-0000-4000-8000-000000000001");
});
test("stored or shared workspace state is bounded and invalid views are ignored", () => {
  assert.equal(viewFromUrl(new URLSearchParams("view=admin-shell")), null);
  assert.equal(viewState({ page: -3 }).page, 0);
  assert.equal(viewState({ page: Infinity }).page, 0);
  assert.equal(viewState({ page: 500000 }).page, 10000);
  assert.equal(viewState({ search: "a".repeat(1000) }).search.length, 200);
  assert.equal(viewState({ date: "tomorrow" }).date, "");
  assert.equal(viewState({ date: "2026-02-30" }).date, "");
  assert.equal(
    new URL(
      stateToUrl("leads", viewState({ scroll: 500 })),
      "https://crm.example",
    ).searchParams.has("scroll"),
    false,
  );
  assert.equal(viewState({ scope: "everyone-privileged" }).scope, "all");
  assert.equal(viewState(null as any).page, 0);
});
