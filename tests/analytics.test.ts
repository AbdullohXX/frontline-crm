import { test } from "node:test";
import assert from "node:assert/strict";
import { analytics, type AnalyticsOptions } from "../src/lib/analytics";
import { demoLeads, demoActivities, demoBootstrap } from "../src/lib/demo";
const base: AnalyticsOptions = {
  from: "2026-10-01",
  to: "2026-10-03",
  owner: "",
  source: "",
  today: "2026-10-03",
  timeZone: "America/New_York",
};
test("Analytics uses company timezone, excludes import events and keeps snapshots independent of dates", () => {
  const leads = [
    {
      ...demoLeads[0],
      id: "one",
      stage: "New" as const,
      value: 100,
      source: "Linkedin",
      next_follow_up: null,
      stage_entered_at: null,
    },
    {
      ...demoLeads[1],
      id: "two",
      stage: "Won" as const,
      value: 200,
      source: " LinkedIn ",
    },
  ];
  const events = [
    {
      ...demoActivities[0],
      id: "a",
      lead_id: "one",
      action: "Call",
      outcome: "Connected",
      created_at: "2026-10-01T02:00:00Z",
    },
    {
      ...demoActivities[0],
      id: "b",
      lead_id: "one",
      action: "Call",
      outcome: "Connected",
      created_at: "2026-10-02T15:00:00Z",
    },
    {
      ...demoActivities[0],
      id: "c",
      lead_id: "two",
      action: "Imported",
      from_stage: "New",
      to_stage: "Won",
      created_at: "2026-10-02T15:00:00Z",
    },
    {
      ...demoActivities[0],
      id: "d",
      lead_id: "two",
      action: "Stage Changed",
      from_stage: "Proposal",
      to_stage: "Won",
      deal_value: 200,
      created_at: "2026-10-02T15:00:00Z",
    },
  ];
  const r = analytics(leads, events, demoBootstrap.members, base);
  assert.equal(r.summary.total, 2);
  assert.equal(r.summary.openValue, 100);
  assert.equal(r.summary.calls, 1);
  assert.equal(r.summary.wins, 1);
  assert.equal(r.summary.revenue, 200);
  assert.equal(r.unknownStageAge, 1);
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].count, 2);
  assert.equal(r.trend.length, 3);
  assert.equal(r.trend[0].calls, 0);
  assert.equal(r.trend[1].calls, 1);
  assert.equal(
    r.heatmap.flat().reduce((s, v) => s + v, 0),
    1,
  );
  const empty = analytics(leads, events, demoBootstrap.members, {
    ...base,
    from: "2026-11-01",
    to: "2026-11-02",
  });
  assert.equal(empty.summary.calls, 0);
  assert.equal(empty.summary.total, 2);
  const scoped = analytics(leads, events, demoBootstrap.members, {
    ...base,
    owner: leads[0].owner_email,
  });
  assert.equal(scoped.summary.total, 1);
  assert.equal(scoped.summary.wins, 0);
});
test("Analytics aggregates beyond the workspace page and empty scopes stay empty", () => {
  const leads = Array.from({ length: 236 }, (_, i) => ({
    ...demoLeads[0],
    id: String(i),
    value: 10,
    stage: "New" as const,
  }));
  const r = analytics(leads, [], demoBootstrap.members, base);
  assert.equal(r.summary.total, 236);
  assert.equal(r.summary.openValue, 2360);
  assert.equal(r.summary.untouched, 236);
  const empty = analytics(leads, [], demoBootstrap.members, {
    ...base,
    source: "missing",
  });
  assert.equal(empty.summary.total, 0);
  assert.equal(empty.quality[0].count, 0);
});
