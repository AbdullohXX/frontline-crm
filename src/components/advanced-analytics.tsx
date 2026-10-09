"use client";
import { useEffect, useState } from "react";
import { STAGES, type Bootstrap } from "@/lib/types";
import type { AdvancedReport, Slice } from "@/lib/analytics";
const colors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
];
function heatStyle(count: number, max: number) {
  const level =
    count / max > 0.66 ? "high" : count / max > 0.33 ? "mid" : "low";
  return {
    background: count ? "var(--heat-" + level + "-bg)" : "var(--chart-track)",
    color: "var(--heat-" + level + "-ink)",
  };
}
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const percent = (n: number, d: number) =>
  d ? `${Math.round((100 * n) / d)}%` : "—";
const shift = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
function Card({
  title,
  hint,
  children,
  wide = false,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={"panel insight-card" + (wide ? " insight-wide" : "")}>
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
      </div>
      <div className="insight-body">{children}</div>
    </section>
  );
}
function Empty() {
  return <div className="empty">No records in this selection.</div>;
}
function Horizontal({
  rows,
  value = false,
  onSelect,
}: {
  rows: Slice[];
  value?: boolean;
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => (value ? r.value || 0 : r.count)));
  return rows.length ? (
    <div className="insight-bars">
      {rows.map((r, i) => {
        const n = value ? r.value || 0 : r.count;
        return (
          <button
            key={r.label}
            disabled={!onSelect}
            onClick={() => onSelect?.(r.label)}
            className="insight-bar"
            aria-label={`${r.label}: ${value ? money(n) : n}`}
          >
            <span>
              {r.label}
              <b>{value ? money(n) : n.toLocaleString()}</b>
            </span>
            <i>
              <em
                style={{
                  width: `${(100 * n) / max}%`,
                  background: colors[i % colors.length],
                }}
              />
            </i>
          </button>
        );
      })}
    </div>
  ) : (
    <Empty />
  );
}
function Donut({ rows }: { rows: Slice[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  let offset = 0;
  return total ? (
    <div className="donut-wrap">
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label={rows.map((r) => `${r.label}: ${r.count}`).join(", ")}
      >
        <circle
          cx="100"
          cy="100"
          r="72"
          fill="none"
          stroke="var(--chart-track)"
          strokeWidth="24"
        />
        {rows.map((r, i) => {
          const portion = (r.count / total) * 100,
            previous = offset;
          offset += portion;
          return (
            <circle
              key={r.label}
              cx="100"
              cy="100"
              r="72"
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth="24"
              pathLength="100"
              strokeDasharray={`${portion} ${100 - portion}`}
              strokeDashoffset={-previous}
              transform="rotate(-90 100 100)"
            >
              <title>
                {r.label}: {r.count} ({percent(r.count, total)})
              </title>
            </circle>
          );
        })}
        <text
          x="100"
          y="99"
          textAnchor="middle"
          fill="var(--text)"
          fontSize="30"
          fontWeight="700"
        >
          {total}
        </text>
        <text
          x="100"
          y="122"
          textAnchor="middle"
          fill="var(--muted)"
          fontSize="12"
        >
          total
        </text>
      </svg>
      <div className="chart-legend">
        {rows.map((r, i) => (
          <div key={r.label}>
            <i style={{ background: colors[i % colors.length] }} />
            <span>{r.label}</span>
            <b>
              {r.count} · {percent(r.count, total)}
            </b>
          </div>
        ))}
      </div>
    </div>
  ) : (
    <Empty />
  );
}
function Trend({
  rows,
  revenue = false,
}: {
  rows: AdvancedReport["trend"];
  revenue?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const keys = revenue
    ? (["revenue"] as const)
    : (["calls", "connected", "emails", "meetings"] as const);
  const rawMax = Math.max(1, ...rows.flatMap((r) => keys.map((k) => r[k])));
  const max = Math.max(4, Math.ceil(rawMax / 4) * 4);
  const x = (i: number) => 50 + (i * 600) / Math.max(1, rows.length - 1),
    y = (n: number) => 205 - (n / max) * 170;
  const active = selected === null ? null : rows[selected];
  return rows.length ? (
    <>
      <div className="trend-summary">
        {active ? (
          <span>
            {active.label} ·{" "}
            {keys
              .map((k) => `${k}: ${revenue ? money(active[k]) : active[k]}`)
              .join(" · ")}
          </span>
        ) : (
          <span>Hover or focus a point to inspect a date</span>
        )}
      </div>
      <svg
        className="trend-svg"
        viewBox="0 0 700 255"
        role="img"
        aria-label={
          revenue
            ? "Recorded won revenue over time"
            : "Calls, connected calls, emails and meetings over time"
        }
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1="50"
              x2="650"
              y1={y(f * max)}
              y2={y(f * max)}
              stroke="var(--border)"
            />
            <text
              x="40"
              y={y(f * max) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--muted)"
            >
              {revenue ? money(f * max) : Math.round(f * max)}
            </text>
          </g>
        ))}
        {keys.map((k, j) => (
          <g key={k}>
            <polyline
              fill="none"
              stroke={colors[j]}
              strokeWidth="3"
              points={rows.map((r, i) => `${x(i)},${y(r[k])}`).join(" ")}
            />
            {rows.map((r, i) => (
              <circle
                key={r.label}
                cx={x(i)}
                cy={y(r[k])}
                r="4"
                fill={colors[j]}
                tabIndex={0}
                aria-label={`${r.label}, ${k}: ${r[k]}`}
                onMouseEnter={() => setSelected(i)}
                onFocus={() => setSelected(i)}
              >
                <title>
                  {r.label}: {k} {revenue ? money(r[k]) : r[k]}
                </title>
              </circle>
            ))}
          </g>
        ))}
        {rows
          .filter(
            (_, i) =>
              i === 0 ||
              i === rows.length - 1 ||
              i === Math.floor(rows.length / 2),
          )
          .map((r) => (
            <text
              key={r.label}
              x={x(rows.indexOf(r))}
              y="235"
              textAnchor="middle"
              fill="var(--muted)"
              fontSize="11"
            >
              {r.label}
            </text>
          ))}
      </svg>
      <div className="line-legend">
        {keys.map((k, i) => (
          <span key={k}>
            <i style={{ background: colors[i] }} />
            {k === "revenue"
              ? "Won value"
              : k.charAt(0).toUpperCase() + k.slice(1)}
          </span>
        ))}
      </div>
    </>
  ) : (
    <Empty />
  );
}
export default function AdvancedAnalytics({
  boot,
  onStage,
}: {
  boot: Bootstrap;
  onStage: (stage: string) => void;
}) {
  const [from, setFrom] = useState(shift(boot.today, -29)),
    [to, setTo] = useState(boot.today),
    [owner, setOwner] = useState(""),
    [source, setSource] = useState(""),
    [tab, setTab] = useState("Overview"),
    [report, setReport] = useState<AdvancedReport | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const query = new URLSearchParams({ from, to, owner, source });
    fetch("/api/analytics?" + query, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analytics could not load");
        setReport(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [from, to, owner, source, refresh]);
  const r = report,
    s = r?.summary;
  const heatMax = Math.max(1, ...(r?.heatmap.flat() || []));
  const exportReport = () => {
    if (!r) return;
    const content = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        timeZone: boot.timeZone,
        filters: { from, to, owner, source },
        report: r,
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "frontline-analytics.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="advanced-analytics">
      <div className="analytics-controls filters">
        <label>
          <span>Activity from</span>
          <input
            aria-label="Analytics from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span>Through</span>
          <input
            aria-label="Analytics through"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          <span>Lead owner</span>
          <select
            aria-label="Analytics owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">All accessible owners</option>
            {(
              r?.options.members ||
              boot.members.map((m) => ({
                email: m.email,
                label: m.display_name,
              }))
            ).map((m) => (
              <option key={m.email} value={m.email}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Lead source</span>
          <select
            aria-label="Analytics source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All sources</option>
            {r?.options.sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="analytics-presets">
        {[7, 30, 90].map((days) => (
          <button
            key={days}
            onClick={() => {
              setFrom(shift(boot.today, 1 - days));
              setTo(boot.today);
            }}
          >
            Last {days} days
          </button>
        ))}
        <button
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          All time
        </button>
        <button
          onClick={() => {
            setOwner("");
            setSource("");
            setFrom(shift(boot.today, -29));
            setTo(boot.today);
          }}
        >
          Reset filters
        </button>
        <button disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
          Refresh analytics
        </button>
        <button disabled={!r || busy || !!error} onClick={exportReport}>
          Export report
        </button>
      </div>
      <div className="analytics-context">
        {boot.timeZone} ·{" "}
        {busy
          ? "Updating analytics…"
          : "All accessible records, across every page"}
        <span>
          Owner and source filter all charts. Dates filter recorded activity.
        </span>
      </div>
      <div
        className="analytics-tabs"
        role="tablist"
        aria-label="Analytics sections"
      >
        {["Overview", "Pipeline & health", "Activity & team"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error ? (
        <div role="alert" className="error">
          {error}
        </div>
      ) : busy ? (
        <div className="empty" role="status">
          Calculating your analytics…
        </div>
      ) : r && s ? (
        <>
          <div className="metrics analytics-metrics">
            {[
              ["Accessible leads", s.total, "Current snapshot"],
              ["Open pipeline", money(s.openValue), `${s.open} open leads`],
              ["Recorded calls", s.calls, "Selected period"],
              [
                "Connection rate",
                percent(s.connected, s.calls),
                "Connected / recorded calls",
              ],
              [
                "Closed win share",
                percent(s.won, s.won + s.lost),
                `${s.won} won · ${s.lost} lost, current snapshot`,
              ],
              [
                "Recorded won value",
                money(s.revenue),
                `${s.wins} won events in period`,
              ],
            ].map(([title, value, hint]) => (
              <div className="metric" key={title}>
                <span className="eyebrow">{title}</span>
                <strong>{value}</strong>
                <span className="muted">{hint}</span>
              </div>
            ))}
          </div>
          <div className="chart-grid">
            {tab === "Overview" && (
              <>
                <Card
                  title="Activity over time"
                  hint={`${r.period.monthly ? "Monthly" : "Daily"} · recorded calls, connections, emails and meetings`}
                  wide
                >
                  <Trend rows={r.trend} />
                </Card>
                <Card
                  title="Current pipeline distribution"
                  hint="Stage counts · select a bar to open those leads"
                >
                  <Horizontal rows={r.stages} onSelect={onStage} />
                </Card>
                <Card
                  title="Call outcome mix"
                  hint="Recorded calls in selected period"
                >
                  <Donut rows={r.outcomes} />
                </Card>
                <Card
                  title="Lead source mix"
                  hint="Current snapshot · case variants combined"
                >
                  <Donut rows={r.sources} />
                </Card>
                <Card
                  title="Follow-up health"
                  hint="Open leads · relative to today in CRM timezone"
                >
                  <Horizontal rows={r.followup} />
                </Card>
                <Card
                  title="Won value over time"
                  hint="Recorded won transitions · repeat wins are included"
                  wide
                >
                  <Trend rows={r.trend} revenue />
                </Card>
                <Card
                  title="Source performance"
                  hint="Current won share is won / (won + lost), not a historical conversion funnel"
                  wide
                >
                  <div className="insight-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Leads</th>
                          <th>Won</th>
                          <th>Lost</th>
                          <th>Closed win share</th>
                          <th>Open value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.sources.map((g) => (
                          <tr key={g.label}>
                            <td>{g.label}</td>
                            <td>{g.count}</td>
                            <td>{g.won}</td>
                            <td>{g.lost}</td>
                            <td>{percent(g.won, g.won + g.lost)}</td>
                            <td>{money(g.openValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
            {tab === "Pipeline & health" && (
              <>
                <Card
                  title="Pipeline value by stage"
                  hint="Unweighted current deal values"
                >
                  <Horizontal rows={r.stages} value onSelect={onStage} />
                </Card>
                <Card
                  title="Open lead age"
                  hint="Original creation date when available; otherwise CRM creation date"
                >
                  <Horizontal rows={r.aging} />
                </Card>
                <Card
                  title="Time in current stage"
                  hint={`Open leads with known stage entry dates · ${r.unknownStageAge} unknown dates excluded`}
                >
                  <Horizontal rows={r.stageAge} />
                </Card>
                <Card title="Open priority mix" hint="Current open leads">
                  <Donut rows={r.priorities} />
                </Card>
                <Card
                  title="Contact & follow-up coverage"
                  hint="Counts overlap · recorded interactions exclude import audit events"
                >
                  <Horizontal rows={r.quality} />
                  <p className="muted">
                    {s.unscheduled} open leads lack a follow-up date.{" "}
                    {s.untouched} have no recorded interaction.
                  </p>
                </Card>
                <Card title="Lead score distribution" hint="Current snapshot">
                  <Horizontal rows={r.scores} />
                </Card>
                <Card
                  title="Industry distribution"
                  hint="Top 10 by current lead count"
                >
                  <Horizontal rows={r.industries.slice(0, 10)} />
                </Card>
                <Card
                  title="Country distribution"
                  hint="Top 10 · US/USA and UK variants combined for reporting"
                >
                  <Horizontal rows={r.countries.slice(0, 10)} />
                </Card>
                <Card
                  title="Loss reasons"
                  hint="Current lost leads · original import reasons may be unknown"
                  wide
                >
                  <Horizontal rows={r.losses} />
                </Card>
              </>
            )}
            {tab === "Activity & team" && (
              <>
                <Card
                  title="Calls by agent"
                  hint="Agent who logged the call · selected owner filters the lead assignment"
                >
                  <Horizontal
                    rows={r.agents.map((a) => ({
                      label: a.label,
                      count: a.calls,
                    }))}
                  />
                </Card>
                <Card
                  title="Connection rate by agent"
                  hint="Connected / recorded calls · agents with no calls omitted"
                >
                  <Horizontal
                    rows={r.agents
                      .filter((a) => a.calls)
                      .map((a) => ({
                        label: `${a.label} (${a.connected}/${a.calls})`,
                        count: Math.round((100 * a.connected) / a.calls),
                      }))}
                  />
                </Card>
                <Card
                  title="Team performance"
                  hint="Assignments and overdue counts are current; calls and won events use selected dates"
                  wide
                >
                  <div className="insight-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Assigned</th>
                          <th>Open</th>
                          <th>Open value</th>
                          <th>Overdue</th>
                          <th>Calls</th>
                          <th>Connected</th>
                          <th>Won events</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.agents.map((a) => (
                          <tr key={a.email}>
                            <td>{a.label}</td>
                            <td>{a.leads}</td>
                            <td>{a.open}</td>
                            <td>{money(a.value)}</td>
                            <td>{a.overdue}</td>
                            <td>{a.calls}</td>
                            <td>{percent(a.connected, a.calls)}</td>
                            <td>{a.wins}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!r.agents.length && <Empty />}
                  </div>
                </Card>
                <Card
                  title="Calling hours"
                  hint={`Recorded call count by weekday and hour · ${boot.timeZone}`}
                  wide
                >
                  <div className="heatmap-scroll">
                    <div className="heatmap">
                      <span />
                      {Array.from({ length: 24 }, (_, h) => (
                        <span key={h} className="heat-hour">
                          {h}
                        </span>
                      ))}
                      {r.heatmap.map((hours, d) => (
                        <div className="heat-row" key={d}>
                          <span>
                            {
                              ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                                d
                              ]
                            }
                          </span>
                          {hours.map((count, h) => (
                            <div
                              key={h}
                              tabIndex={0}
                              className="heat-cell"
                              style={heatStyle(count, heatMax)}
                              aria-label={`${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]} ${h}:00: ${count} calls`}
                              title={`${h}:00 · ${count} calls`}
                            >
                              {count || ""}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="muted">
                    Stronger color means more calls. Times show when calls were
                    logged, not carrier-verified call start times.
                  </p>
                </Card>
                <Card
                  title="Activity over time"
                  hint="Recorded events in selected period"
                  wide
                >
                  <Trend rows={r.trend} />
                </Card>
              </>
            )}
          </div>
          <div className="notice">
            Snapshot charts describe current lead records. Imported history is
            not reconstructed. All charts respect database permissions. Event
            charts describe activity logged in this CRM; Quo provider activity
            is shown separately above.
          </div>
        </>
      ) : null}
    </div>
  );
}
