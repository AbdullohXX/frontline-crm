"use client";
import { useState } from "react";
type Result = {
  sourceRows: number;
  currentRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  ambiguousRows: number;
  currentNotMatched: number;
  errors: string[];
  warnings: string[];
  rows: {
    company: string;
    legacy_id: string;
    outcome: string;
    fields: string[];
  }[];
};
export default function Reconciliation() {
  const [csv, setCsv] = useState(""),
    [format, setFormat] = useState("ISO"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Result | null>(null);
  async function compare() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, dateFormat: format }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel reconciliation">
      <div className="panel-head">
        <div>
          <h3>Compare current data with a Sheets export</h3>
          <p>
            Read-only comparison. No rows are imported, overwritten or deleted.
          </p>
        </div>
      </div>
      <div className="panel-content">
        <label className="field">
          <span>Latest lead-tab CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              setCsv((await e.target.files?.[0]?.text()) || "");
              setResult(null);
            }}
          />
        </label>
        <label className="field">
          <span>CSV date format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="ISO">YYYY-MM-DD</option>
            <option value="MDY">MM/DD/YYYY</option>
            <option value="DMY">DD/MM/YYYY</option>
          </select>
        </label>
        <button className="primary" disabled={!csv || busy} onClick={compare}>
          {busy ? "Comparing…" : "Compare without writing"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <>
            <p>
              {result.sourceRows} source rows · {result.currentRows} current
              rows · {result.newRows} new · {result.changedRows} changed ·{" "}
              {result.unchangedRows} unchanged · {result.ambiguousRows}{" "}
              ambiguous · {result.currentNotMatched} current rows not matched
            </p>
            <p className="fine">
              New rows are candidates for import. Changed and ambiguous matches
              require review; unmatched current rows are retained.
            </p>
            {result.errors.length > 0 && (
              <div className="error">
                {result.errors.length} source errors prevent a complete
                comparison.
                <br />
                {result.errors.slice(0, 10).join("\n")}
              </div>
            )}
            <button
              onClick={() => {
                const u = URL.createObjectURL(
                  new Blob([JSON.stringify(result, null, 2)], {
                    type: "application/json",
                  }),
                );
                const a = document.createElement("a");
                a.href = u;
                a.download = "frontline-data-comparison.json";
                a.click();
                URL.revokeObjectURL(u);
              }}
            >
              Download comparison
            </button>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Source ID</th>
                    <th>Match</th>
                    <th>Changed fields</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows
                    .filter((r) => r.outcome !== "Unchanged")
                    .slice(0, 100)
                    .map((r, i) => (
                      <tr key={i}>
                        <td>{r.company}</td>
                        <td>{r.legacy_id || "No source ID"}</td>
                        <td>{r.outcome}</td>
                        <td>{r.fields.join(", ") || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="fine">
              Up to 100 differences shown. The download includes every
              comparison row.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
