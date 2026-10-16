"use client";
import { useEffect, useState } from "react";
import type { Bootstrap, Lead } from "@/lib/types";
import Handoff from "./handoff";
export default function HandoffInbox({
  boot,
  onOpen,
}: {
  boot: Bootstrap;
  onOpen: (l: Lead) => void;
}) {
  const [rows, setRows] = useState<Lead[]>([]),
    [error, setError] = useState(""),
    [page, setPage] = useState(0),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    fetch("/api/handoff?page=" + page, { signal: c.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        return d;
      })
      .then((d) => {
        setRows(d.leads);
        setMore(d.hasMore);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [page]);
  return (
    <section className="panel">
      <h3>Sales handoffs</h3>
      <p>Pending transfers and returned leads needing attention.</p>
      {loading ? (
        <p>Loading handoffs…</p>
      ) : rows.length ? (
        rows.map((l) => (
          <article key={l.id}>
            <button onClick={() => onOpen(l)}>{l.company}</button>
            <Handoff
              boot={boot}
              lead={l}
              onSaved={(updated) =>
                setRows((old) =>
                  old.map((x) => (x.id === updated.id ? updated : x)),
                )
              }
            />
          </article>
        ))
      ) : (
        <p>No pending or returned handoffs.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="flex">
        <button
          disabled={!page || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <button
          disabled={!more || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
