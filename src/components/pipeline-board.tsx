"use client";
import { useEffect, useRef, useState } from "react";
import { STAGES, type Lead, type Member } from "@/lib/types";
import { callingInfo } from "@/lib/workflow";

type Lane = { rows: Lead[]; total: number; page: number };
export default function PipelineBoard({
  canMove = true,
  filters,
  revision,
  members,
  onOpen,
  onMove,
}: {
  canMove?: boolean;
  filters: string;
  revision: number;
  members: Member[];
  onOpen: (lead: Lead) => void;
  onMove: (lead: Lead, stage: string) => Promise<Lead[] | undefined>;
}) {
  const [lanes, setLanes] = useState<Record<string, Lane>>({});
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState("");
  const generation = useRef(0),
    pending = useRef(new Set<string>());
  const activeStages = new URLSearchParams(filters).get("stage");
  const stages = STAGES.filter((s) => !activeStages || s === activeStages);

  async function page(
    stage: string,
    n: number,
    signal?: AbortSignal,
  ): Promise<Lane> {
    const q = new URLSearchParams(filters);
    q.set("stage", stage);
    q.set("page", String(n));
    const r = await fetch("/api/leads?" + q, { signal, cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Could not load pipeline");
    return { rows: d.leads, total: d.total, page: n };
  }
  useEffect(() => {
    const request = ++generation.current;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    Promise.all(
      stages.map(async (s) => [s, await page(s, 0, abort.signal)] as const),
    )
      .then((entries) => {
        if (request === generation.current)
          setLanes(Object.fromEntries(entries));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      generation.current++;
    };
  }, [filters, revision]);

  async function more(stage: string) {
    const token = generation.current;
    setBusy((b) => [...b, stage]);
    setError("");
    try {
      const data = await page(stage, lanes[stage].page + 1);
      if (token === generation.current)
        setLanes((old) => ({
          ...old,
          [stage]: {
            ...data,
            rows: [
              ...new Map(
                [...old[stage].rows, ...data.rows].map((l) => [l.id, l]),
              ).values(),
            ],
          },
        }));
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      setBusy((b) => b.filter((v) => v !== stage));
    }
  }
  async function move(lead: Lead, next: string) {
    if (!canMove || lead.stage === next || pending.current.has(lead.id)) return;
    if (next === "Lost") {
      await onMove(lead, next);
      return;
    }
    const token = generation.current;
    pending.current.add(lead.id);
    setBusy((b) => [...b, lead.id]);
    const apply = (
      all: Record<string, Lane>,
      from: string,
      to: string,
      row: Lead,
    ) => {
      const copy = { ...all };
      if (copy[from])
        copy[from] = {
          ...copy[from],
          total: Math.max(0, copy[from].total - 1),
          rows: copy[from].rows.filter((l) => l.id !== row.id),
        };
      if (copy[to])
        copy[to] = {
          ...copy[to],
          total: copy[to].total + 1,
          rows: [row, ...copy[to].rows.filter((l) => l.id !== row.id)],
        };
      return copy;
    };
    setLanes((old) =>
      apply(old, lead.stage, next, { ...lead, stage: next as Lead["stage"] }),
    );
    try {
      const saved = await onMove(lead, next);
      if (!saved?.length) throw Error("Move failed. The card was restored.");
      if (token === generation.current)
        setLanes((old) =>
          Object.fromEntries(
            Object.entries(old).map(([s, lane]) => [
              s,
              {
                ...lane,
                rows: lane.rows.map((l) => (l.id === lead.id ? saved[0] : l)),
              },
            ]),
          ),
        );
    } catch (e) {
      if (token === generation.current) {
        setLanes((old) => apply(old, next, lead.stage, lead));
        setError((e as Error).message);
      }
    } finally {
      pending.current.delete(lead.id);
      setBusy((b) => b.filter((v) => v !== lead.id));
    }
  }
  return (
    <section aria-label="Complete filtered sales pipeline" aria-busy={loading}>
      <div className="board-context">
        <span>
          {loading
            ? "Loading stages…"
            : `${Object.values(lanes).reduce((n, l) => n + l.total, 0)} matching leads across all stages`}
        </span>
        <span>Drag a card or use its stage control</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="board">
        {stages.map((stage) => {
          const lane = lanes[stage];
          return (
            <section
              key={stage}
              data-stage={stage}
              className={"lane " + (target === stage ? "drop-target" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setTarget(stage);
              }}
              onDragLeave={() => setTarget("")}
              onDrop={(e) => {
                e.preventDefault();
                setTarget("");
                const lead = Object.values(lanes)
                  .flatMap((l) => l.rows)
                  .find((l) => l.id === e.dataTransfer.getData("text/plain"));
                if (lead) void move(lead, stage);
              }}
            >
              <div className="lane-head">
                <h3>
                  {stage}
                  <span>{loading ? "…" : lane?.total || 0}</span>
                </h3>
              </div>
              {!loading &&
                lane?.rows.map((lead) => (
                  <article
                    className="deal-card"
                    key={lead.id}
                    aria-busy={busy.includes(lead.id)}
                    draggable={canMove && !busy.includes(lead.id)}
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", lead.id)
                    }
                    onDragEnd={() => setTarget("")}
                  >
                    <button
                      className="text-button"
                      onClick={() => onOpen(lead)}
                    >
                      {lead.company}
                    </button>
                    <p>{lead.contact || "Add a contact"}</p>
                    <small>
                      {members.find((m) => m.email === lead.owner_email)
                        ?.display_name || "Unassigned"}
                    </small>
                    <p
                      className={
                        lead.next_follow_up &&
                        lead.next_follow_up <
                          new Date().toLocaleDateString("en-CA", {
                            timeZone: "America/New_York",
                          })
                          ? "overdue-text"
                          : "muted"
                      }
                    >
                      {lead.next_action || "Needs a next step"}
                      <br />
                      {lead.next_follow_up || "Not scheduled"}
                    </p>
                    {callingInfo(lead).open && (
                      <small className="calling-open">
                        Calling window open · {callingInfo(lead).time}
                      </small>
                    )}
                    <div className="card-meta">
                      <span
                        className={
                          lead.priority === "High" ? "priority" : "muted"
                        }
                      >
                        {lead.priority}
                      </span>
                      <small>{busy.includes(lead.id) ? "Saving…" : ""}</small>
                      <select
                        aria-label={"Stage for " + lead.company}
                        value={lead.stage}
                        disabled={!canMove || busy.includes(lead.id)}
                        onChange={(e) => void move(lead, e.target.value)}
                      >
                        {STAGES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
              {!loading && !lane?.rows.length && (
                <p className="empty">No matching leads in this stage.</p>
              )}
              {!loading && lane && lane.rows.length < lane.total && (
                <button
                  className="lane-more"
                  disabled={busy.includes(stage)}
                  onClick={() => void more(stage)}
                >
                  {busy.includes(stage)
                    ? "Loading…"
                    : `Load more · ${lane.rows.length} of ${lane.total}`}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
