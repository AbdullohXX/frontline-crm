import { STAGES, type Lead, type Activity, type Member } from "./types";
export type Slice = { label: string; count: number; value?: number };
export type AnalyticsOptions = {
  from: string | null;
  to: string | null;
  owner: string;
  source: string;
  today: string;
  timeZone: string;
};
const closed = (l: Lead) => l.stage === "Won" || l.stage === "Lost";
const cash = (l: Lead) => Number(l.value) || 0;
const age = (day: string, today: string) =>
  Math.max(0, Math.floor((Date.parse(today) - Date.parse(day)) / 86400000));
const normalized = (v: string) => v.trim().toLowerCase() || "unknown";
const label = (v: string) =>
  normalized(v) === "linkedin" ? "LinkedIn" : v.trim() || "Unknown";
const countryLabel = (v: string) => {
  const raw = v.trim(),
    key = raw.toLowerCase();
  if (/^(us|usa|u\.s\.|united states)(?:$|[-, ])/.test(key))
    return "United States";
  if (/^(uk|u\.k\.|united kingdom)(?:$|[-, ])/.test(key))
    return "United Kingdom";
  return raw || "Unknown";
};
export function analytics(
  leads: Lead[],
  activities: Activity[],
  members: Member[],
  o: AnalyticsOptions,
) {
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: o.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayCache = new Map<string, string>();
  const day = (stamp: string) => {
    let value = dayCache.get(stamp);
    if (!value) {
      value = dateFormatter.format(new Date(stamp));
      dayCache.set(stamp, value);
    }
    return value;
  };
  const filtered = leads.filter(
    (l) =>
      (!o.owner || l.owner_email === o.owner) &&
      (!o.source || normalized(l.source) === o.source),
  );
  const ids = new Set(filtered.map((l) => l.id));
  const period = activities.filter(
    (a) =>
      ids.has(a.lead_id) &&
      a.action !== "Imported" &&
      (!o.from || day(a.created_at) >= o.from) &&
      (!o.to || day(a.created_at) <= o.to),
  );
  const calls = period.filter((a) => a.action === "Call"),
    wins = period.filter(
      (a) =>
        ["Created", "Stage Changed"].includes(a.action) &&
        a.to_stage === "Won" &&
        a.from_stage !== "Won",
    );
  const open = filtered.filter((l) => !closed(l));
  const groups = (rows: Lead[], key: (l: Lead) => string): Slice[] => {
    const map = new Map<string, Slice>();
    for (const l of rows) {
      const k = key(l),
        r = map.get(k) || { label: k, count: 0, value: 0 };
      r.count++;
      r.value! += cash(l);
      map.set(k, r);
    }
    return [...map.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    );
  };
  const eventGroups = (key: (a: Activity) => string) => {
    const map = new Map<string, number>();
    for (const a of calls) {
      const k = key(a);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  };
  const sourceNames = new Map<string, string>();
  leads.forEach((l) => {
    const k = normalized(l.source);
    if (!sourceNames.has(k)) sourceNames.set(k, label(l.source));
  });
  const sources = [...sourceNames]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const sourcePerformance = groups(
    filtered,
    (l) => sourceNames.get(normalized(l.source)) || "Unknown",
  ).map((g) => {
    const rows = filtered.filter(
      (l) => (sourceNames.get(normalized(l.source)) || "Unknown") === g.label,
    );
    return {
      ...g,
      won: rows.filter((l) => l.stage === "Won").length,
      lost: rows.filter((l) => l.stage === "Lost").length,
      openValue: rows
        .filter((l) => !closed(l))
        .reduce((s, l) => s + cash(l), 0),
    };
  });
  const end = o.to || o.today,
    start =
      o.from ||
      period.reduce(
        (s, a) => (day(a.created_at) < s ? day(a.created_at) : s),
        end,
      );
  const monthly = age(start, end) > 120;
  if (age(start, end) > 10950)
    throw new Error("Choose an activity period of 30 years or less.");
  const buckets = new Map<
    string,
    {
      label: string;
      calls: number;
      connected: number;
      wins: number;
      revenue: number;
      emails: number;
      meetings: number;
    }
  >();
  let cursor = start;
  while (cursor <= end && buckets.size < 366) {
    const k = monthly ? cursor.slice(0, 7) : cursor;
    buckets.set(k, {
      label: k,
      calls: 0,
      connected: 0,
      wins: 0,
      revenue: 0,
      emails: 0,
      meetings: 0,
    });
    const d = new Date(cursor + "T12:00:00Z");
    if (monthly) {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
    } else d.setUTCDate(d.getUTCDate() + 1);
    cursor = d.toISOString().slice(0, 10);
  }
  const winIds = new Set(wins.map((w) => w.id));
  for (const a of period) {
    const k = monthly ? day(a.created_at).slice(0, 7) : day(a.created_at);
    const b = buckets.get(k);
    if (!b) continue;
    if (a.action === "Call") {
      b.calls++;
      if (a.outcome === "Connected") b.connected++;
    }
    if (a.action === "Email") b.emails++;
    if (a.action === "Meeting") b.meetings++;
    if (winIds.has(a.id)) {
      b.wins++;
      b.revenue += Number(a.deal_value) || 0;
    }
  }
  const ages = [
    "0–7 days",
    "8–30 days",
    "31–60 days",
    "61–90 days",
    "91+ days",
  ];
  const ageBucket = (n: number) =>
    ages[n <= 7 ? 0 : n <= 30 ? 1 : n <= 60 ? 2 : n <= 90 ? 3 : 4];
  const allEvents = activities.filter(
    (a) =>
      ids.has(a.lead_id) &&
      ["Call", "Email", "Meeting", "Note"].includes(a.action),
  );
  const touched = new Set(allEvents.map((a) => a.lead_id));
  const followupLabels = [
    "Overdue",
    "Today",
    "Next 7 days",
    "Later",
    "Unscheduled",
  ];
  const future = new Date(Date.parse(o.today) + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const followup = groups(open, (l) =>
    !l.next_follow_up
      ? "Unscheduled"
      : l.next_follow_up < o.today
        ? "Overdue"
        : l.next_follow_up === o.today
          ? "Today"
          : l.next_follow_up <= future
            ? "Next 7 days"
            : "Later",
  ).sort(
    (a, b) => followupLabels.indexOf(a.label) - followupLabels.indexOf(b.label),
  );
  const agentPerformance = members
    .filter(
      (m) =>
        filtered.some((l) => l.owner_email === m.email) ||
        period.some((a) => a.actor_email === m.email),
    )
    .map((m) => {
      const assigned = filtered.filter((l) => l.owner_email === m.email),
        agentCalls = calls.filter((a) => a.actor_email === m.email);
      return {
        email: m.email,
        label: m.display_name,
        leads: assigned.length,
        open: assigned.filter((l) => !closed(l)).length,
        value: assigned
          .filter((l) => !closed(l))
          .reduce((s, l) => s + cash(l), 0),
        overdue: assigned.filter(
          (l) => !closed(l) && !!l.next_follow_up && l.next_follow_up < o.today,
        ).length,
        calls: agentCalls.length,
        connected: agentCalls.filter((a) => a.outcome === "Connected").length,
        wins: wins.filter((a) => a.actor_email === m.email).length,
      };
    })
    .sort((a, b) => b.calls - a.calls || b.leads - a.leads);
  const won = filtered.filter((l) => l.stage === "Won").length,
    lost = filtered.filter((l) => l.stage === "Lost").length;
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: o.timeZone,
    weekday: "short",
  });
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: o.timeZone,
    hour: "numeric",
    hourCycle: "h23",
  });
  for (const call of calls) {
    const stamp = new Date(call.created_at);
    const d = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
      weekdayFormatter.format(stamp),
    );
    const h = Number(hourFormatter.format(stamp));
    heatmap[d][h]++;
  }
  return {
    options: {
      members: members.map((m) => ({ email: m.email, label: m.display_name })),
      sources,
    },
    period: { from: start, to: end, monthly },
    summary: {
      total: filtered.length,
      open: open.length,
      openValue: open.reduce((s, l) => s + cash(l), 0),
      won,
      lost,
      calls: calls.length,
      connected: calls.filter((a) => a.outcome === "Connected").length,
      wins: wins.length,
      revenue: wins.reduce((s, a) => s + (Number(a.deal_value) || 0), 0),
      overdue: followup.find((g) => g.label === "Overdue")?.count || 0,
      unscheduled: followup.find((g) => g.label === "Unscheduled")?.count || 0,
      untouched: open.filter((l) => !touched.has(l.id)).length,
    },
    stages: STAGES.map((stage) => ({
      label: stage,
      count: filtered.filter((l) => l.stage === stage).length,
      value: filtered
        .filter((l) => l.stage === stage)
        .reduce((s, l) => s + cash(l), 0),
    })),
    followup,
    outcomes: eventGroups((a) => a.outcome || "Unknown"),
    sources: sourcePerformance,
    agents: agentPerformance,
    trend: [...buckets.values()],
    aging: groups(open, (l) =>
      ageBucket(age(l.original_created_date || day(l.created_at), o.today)),
    ).sort((a, b) => ages.indexOf(a.label) - ages.indexOf(b.label)),
    stageAge: groups(
      open.filter((l) => l.stage_entered_at),
      (l) => ageBucket(age(day(l.stage_entered_at!), o.today)),
    ).sort((a, b) => ages.indexOf(a.label) - ages.indexOf(b.label)),
    unknownStageAge: open.filter((l) => !l.stage_entered_at).length,
    industries: groups(filtered, (l) => l.industry.trim() || "Unknown"),
    countries: groups(filtered, (l) => countryLabel(l.country)),
    priorities: groups(open, (l) => l.priority),
    scores: groups(filtered, (l) =>
      l.score === null
        ? "Unknown"
        : l.score < 25
          ? "0–24"
          : l.score < 50
            ? "25–49"
            : l.score < 75
              ? "50–74"
              : "75–100",
    ).sort((a, b) => a.label.localeCompare(b.label)),
    losses: groups(
      filtered.filter((l) => l.stage === "Lost"),
      (l) => l.loss_reason || "Unknown",
    ),
    quality: [
      { label: "Has email", count: filtered.filter((l) => !!l.email).length },
      { label: "Has phone", count: filtered.filter((l) => !!l.phone).length },
      {
        label: "Open with follow-up",
        count: open.filter((l) => !!l.next_follow_up).length,
      },
      {
        label: "Open with recorded interaction",
        count: open.filter((l) => touched.has(l.id)).length,
      },
    ],
    heatmap,
  };
}
export type AdvancedReport = ReturnType<typeof analytics>;
