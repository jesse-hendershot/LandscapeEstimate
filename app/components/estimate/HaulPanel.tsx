"use client";

/**
 * Where the hauling number comes from, in plain terms: loads per material,
 * store runs, shop round trips, this week's diesel. And the one knob that
 * changes it most on the day: how many trucks go to the job.
 */

import Link from "next/link";

import { C } from "../../theme";
import { fmt } from "./totals";
import type { HaulDetail } from "./types";

const money = (cents: number) => `$${fmt(cents / 100)}`;
const mi = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

export default function HaulPanel({
  haul,
  total,
  computed,
  trucksForJob,
  onTrucks,
  busy,
}: {
  haul: HaulDetail | null;
  total: number;
  computed: boolean;
  trucksForJob: number;
  onTrucks: (n: number) => void;
  busy: boolean;
}) {
  const plan = haul?.plan ?? null;
  const approx = haul?.distanceSource !== "road";

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: `2px solid rgba(45,106,79,0.15)`, padding: 24, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🚚 Hauling</h3>
        <span style={{ fontSize: 22, fontWeight: 700, color: C.green }}>${fmt(total)}</span>
        {busy && <span style={{ fontSize: 14, color: C.grey }}>updating…</span>}
      </div>

      {haul && <div style={{ fontSize: 14, color: C.grey, marginBottom: 12 }}>Diesel: {haul.diesel.label}</div>}

      {!computed && (
        <div style={{ background: "#FFF9E6", border: `1px solid ${C.amber}`, borderRadius: 10, padding: "10px 14px", fontSize: 15, marginBottom: 12 }}>
          This hauling number is the AI&apos;s rough guess. <Link href="/settings" style={{ color: C.green, fontWeight: 700 }}>Add your trucks and shop address</Link> and it gets
          worked out from real distances, loads and diesel.
        </div>
      )}

      {plan && (
        <div style={{ display: "grid", gap: 6, fontSize: 15, marginBottom: 14 }}>
          {plan.lines
            .filter((l) => l.haulCents > 0 || l.loads > 0)
            .filter((l) => l.mode === "dump" || l.mode === "delivered")
            .map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                <span>
                  {l.material}:{" "}
                  {l.mode === "delivered"
                    ? "supplier delivers"
                    : `${l.loads} load${l.loads === 1 ? "" : "s"}, ${l.oneWayMiles === null ? "?" : mi(l.oneWayMiles)} mi each way${l.approx ? " (approx)" : ""}`}
                </span>
                <b>{money(l.haulCents)}</b>
              </div>
            ))}
          {plan.pickupStops.map((s, i) => (
            <div key={`s${i}`} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <span>
                Store run — {s.supplier} ({s.lines} item{s.lines === 1 ? "" : "s"}, {mi(s.miles)} mi round trip)
              </span>
              <b>{money(s.cents)}</b>
            </div>
          ))}
          {plan.commute.trucks > 0 && (
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <span>
                Shop ↔ job: {plan.commute.trucks} truck{plan.commute.trucks === 1 ? "" : "s"} × {mi(plan.commute.milesEach)} mi
              </span>
              <b>{money(plan.commute.cents)}</b>
            </div>
          )}
          <div style={{ fontSize: 13, color: C.grey, marginTop: 4 }}>
            {Math.round(plan.totalMiles)} truck miles{approx ? " (straight-line estimate)" : ""} · about {mi(plan.totalHours)} truck hours
            {plan.trucksUsed.length > 0 && ` · ${plan.trucksUsed.map((t) => `${t.name}: ${t.loads}`).join(", ")}`}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Trucks on this job:</span>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onTrucks(n)}
            disabled={busy}
            style={{
              fontSize: 18,
              fontWeight: 700,
              width: 48,
              height: 44,
              borderRadius: 10,
              border: `2px solid ${n === trucksForJob ? C.green : C.line}`,
              background: n === trucksForJob ? C.green : "#fff",
              color: n === trucksForJob ? "#fff" : C.black,
              cursor: "pointer",
            }}
          >
            {n}
          </button>
        ))}
        <span style={{ fontSize: 13, color: C.grey }}>More trucks = done sooner, but each one adds a trip to and from the shop.</span>
      </div>

      {haul?.warnings && haul.warnings.length > 0 && (
        <ul style={{ margin: "14px 0 0", paddingLeft: 20, fontSize: 14, color: "#8a5a00" }}>
          {haul.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
