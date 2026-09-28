"use client";

/**
 * Field test: the app versus the legal pad, job by job.
 *
 * For each real job: what the app said, what the hand estimate said, how long
 * each took, and (later) what the job actually cost. The summary turns that
 * into the two numbers a skeptic cares about — is it as accurate, and how much
 * time does it give back.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { C } from "../theme";
import type { EstimateListItem } from "@/lib/estimates/service";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function Field({
  value,
  onSave,
  width = 110,
  prefix,
  ariaLabel,
  numeric = true,
}: {
  value: number | string | null;
  onSave: (v: string) => void;
  width?: number;
  prefix?: string;
  ariaLabel: string;
  numeric?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", background: C.yellow, borderRadius: 6 }}>
      {prefix && <span style={{ paddingLeft: 6, color: "#888" }}>{prefix}</span>}
      <input
        aria-label={ariaLabel}
        inputMode={numeric ? "decimal" : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== (value === null ? "" : String(value))) onSave(text);
        }}
        style={{ width, fontSize: 15, padding: "8px 6px", border: "none", background: "transparent", outline: "none" }}
      />
    </span>
  );
}

export default function FieldTestPage() {
  const [rows, setRows] = useState<EstimateListItem[] | null>(null);
  const [rate, setRate] = useState(400);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/estimates");
      if (res.ok) setRows((await res.json()).estimates);
      try {
        const r = Number(localStorage.getItem("le_hourly_value"));
        if (r > 0) setRate(r);
      } catch {
        // private window — the default is fine
      }
    })();
  }, []);

  async function save(id: string, patch: Record<string, unknown>) {
    setSaving(id);
    try {
      const res = await fetch(`/api/estimates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const v = await res.json();
        setRows((all) =>
          all?.map((r) =>
            r.id === id
              ? {
                  ...r,
                  handTotal: v.fieldTest.handTotal,
                  handMinutes: v.fieldTest.handMinutes,
                  actualTotal: v.fieldTest.actualTotal,
                  fieldNotes: v.fieldTest.fieldNotes,
                }
              : r
          ) ?? null
        );
      }
    } finally {
      setSaving(null);
    }
  }

  const num = (s: string) => {
    const n = parseFloat(s.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const stats = useMemo(() => {
    const list = rows ?? [];
    const mid = (r: EstimateListItem) => (r.appLow + r.appHigh) / 2;
    const vsHand = list.filter((r) => r.handTotal && r.handTotal > 0);
    const withActual = list.filter((r) => r.actualTotal && r.actualTotal > 0);
    const timed = list.filter((r) => r.handMinutes && r.appMinutes !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

    const savedMin = timed.reduce((a, r) => a + Math.max(0, (r.handMinutes ?? 0) - (r.appMinutes ?? 0)), 0);
    return {
      total: list.length,
      vsHandN: vsHand.length,
      vsHandErr: avg(vsHand.map((r) => Math.abs(mid(r) - r.handTotal!) / r.handTotal!)),
      actualN: withActual.length,
      appErr: avg(withActual.map((r) => Math.abs(mid(r) - r.actualTotal!) / r.actualTotal!)),
      handErr: avg(withActual.filter((r) => r.handTotal).map((r) => Math.abs(r.handTotal! - r.actualTotal!) / r.actualTotal!)),
      timedN: timed.length,
      avgHandMin: avg(timed.map((r) => r.handMinutes!)),
      avgAppMin: avg(timed.map((r) => r.appMinutes!)),
      savedHours: savedMin / 60,
      editedN: list.filter((r) => r.edited).length,
    };
  }, [rows]);

  function exportCsv() {
    if (!rows) return;
    const head = ["date", "address", "description", "app_low", "app_high", "app_original_low", "app_original_high", "edited", "hand_total", "hand_minutes", "app_minutes", "actual_total", "notes"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
      [r.createdAt.slice(0, 10), r.jobAddress, r.jobDescription.split("\n")[0], r.appLow, r.appHigh, r.originalLow, r.originalHigh, r.edited, r.handTotal, r.handMinutes, r.appMinutes, r.actualTotal, r.fieldNotes]
        .map(esc)
        .join(",")
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `field-test-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const statBox = (label: string, value: string, sub?: string) => (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.grey, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: C.grey, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <main style={{ flex: 1, background: C.bg }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 16px 80px" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>🧪 Field test</h1>
        <p style={{ fontSize: 16, color: C.grey, margin: "0 0 20px", maxWidth: 760, lineHeight: 1.5 }}>
          For the next several real jobs, do the legal pad like normal and run the same job here. Enter the hand total and how long it took; add what the job
          actually cost once it&apos;s done. Compare like with like — materials, hauling and tax, before markup.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 20 }}>
          {statBox("Jobs compared", `${stats.vsHandN} of ${stats.total}`, `${stats.editedN} edited after generating`)}
          {statBox(
            "App vs hand",
            stats.vsHandErr === null ? "—" : `${pct(stats.vsHandErr)} apart`,
            "average difference between the two totals"
          )}
          {statBox(
            "Closer to the real cost",
            stats.appErr === null ? "—" : `App ${pct(stats.appErr)}${stats.handErr !== null ? ` · Hand ${pct(stats.handErr)}` : ""}`,
            stats.actualN ? `off from actual, over ${stats.actualN} finished job${stats.actualN === 1 ? "" : "s"}` : "add actual costs as jobs finish"
          )}
          {statBox(
            "Time back",
            stats.timedN ? `${stats.savedHours.toFixed(1)} hrs` : "—",
            stats.timedN
              ? `${Math.round(stats.avgHandMin!)} min by hand vs ${Math.round(stats.avgAppMin!)} min in the app · ${money(stats.savedHours * rate)} at $${rate}/hr`
              : "enter minutes by hand to see this"
          )}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ fontSize: 15 }}>
            Value of an hour of your time: $
            <input
              aria-label="Hourly value"
              type="number"
              value={rate}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                setRate(v);
                try {
                  localStorage.setItem("le_hourly_value", String(v));
                } catch {
                  // fine
                }
              }}
              style={{ width: 90, fontSize: 15, padding: "6px 8px", marginLeft: 4, border: "2px solid #d1d5db", borderRadius: 6 }}
            />
          </label>
          <button type="button" onClick={exportCsv} style={{ marginLeft: "auto", background: "#fff", color: C.green, border: `2px solid ${C.green}`, fontSize: 15, fontWeight: 700, padding: "8px 14px", borderRadius: 10, cursor: "pointer" }}>
            ⬇ Export CSV
          </button>
        </div>

        <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.line}`, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000, fontSize: 15 }}>
            <thead>
              <tr style={{ background: C.lgn, textAlign: "left" }}>
                {["Job", "App total", "Hand total", "Min by hand", "Min in app", "Actual cost", "Notes"].map((h) => (
                  <th key={h} style={{ padding: "12px 10px", fontSize: 13, color: C.green, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr>
                  <td style={{ padding: 16 }} colSpan={7}>
                    Loading…
                  </td>
                </tr>
              )}
              {rows?.map((r) => {
                const mid = (r.appLow + r.appHigh) / 2;
                const diff = r.handTotal ? (mid - r.handTotal) / r.handTotal : null;
                return (
                  <tr key={r.id} style={{ borderTop: `1px solid ${C.line}`, verticalAlign: "top", opacity: saving === r.id ? 0.6 : 1 }}>
                    <td style={{ padding: 10, maxWidth: 300 }}>
                      <Link href={`/?id=${r.id}`} style={{ fontWeight: 700, color: C.black }}>
                        {r.jobAddress}
                      </Link>
                      <div style={{ fontSize: 13, color: C.grey }}>
                        {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {r.jobDescription.split("\n")[0].slice(0, 80)}
                      </div>
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      <b>{money(mid)}</b>
                      {r.edited && <div style={{ fontSize: 12, color: C.grey }}>edited (was {money((r.originalLow + r.originalHigh) / 2)})</div>}
                      {diff !== null && (
                        <div style={{ fontSize: 12, fontWeight: 700, color: Math.abs(diff) <= 0.1 ? C.green : "#8a5a00" }}>
                          {diff >= 0 ? "+" : ""}
                          {pct(diff)} vs hand
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 10 }}>
                      <Field ariaLabel="Hand total" prefix="$" value={r.handTotal} onSave={(v) => save(r.id, { handTotal: num(v) })} />
                    </td>
                    <td style={{ padding: 10 }}>
                      <Field ariaLabel="Minutes by hand" width={70} value={r.handMinutes} onSave={(v) => save(r.id, { handMinutes: num(v) === null ? null : Math.round(num(v)!) })} />
                    </td>
                    <td style={{ padding: 10 }}>{r.appMinutes === null ? "—" : r.appMinutes}</td>
                    <td style={{ padding: 10 }}>
                      <Field ariaLabel="Actual cost" prefix="$" value={r.actualTotal} onSave={(v) => save(r.id, { actualTotal: num(v) })} />
                    </td>
                    <td style={{ padding: 10 }}>
                      <Field ariaLabel="Notes" numeric={false} width={200} value={r.fieldNotes} onSave={(v) => save(r.id, { fieldNotes: v })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
