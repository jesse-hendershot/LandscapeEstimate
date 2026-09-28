"use client";

/**
 * Machine fuel: engine hours per machine, and what they burn.
 *
 * The AI proposes the hours from the job (feet of trench, yards moved); the
 * estimator knows the yard, so every number here is editable. Changing hours,
 * adding a machine or removing one saves and re-prices, like any other edit.
 */

import Link from "next/link";
import { useState } from "react";

import { C } from "../../theme";
import { fmt } from "./totals";
import type { HaulDetail } from "./types";

export interface EquipmentOption {
  id: string;
  name: string;
  kind: string;
  fuel: "offroad" | "diesel" | "gas";
  galPerHour: number;
}

type Line = NonNullable<HaulDetail["machines"]>[number];
type Use = { equipmentId: string; hours: number; basis?: string };

const FUEL_WORD = { offroad: "off-road diesel", diesel: "diesel", gas: "gas" } as const;

function HoursInput({ value, onCommit, disabled }: { value: number; onCommit: (h: number) => void; disabled: boolean }) {
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(String(value));
  }
  const commit = () => {
    const h = parseFloat(text);
    if (Number.isFinite(h) && h >= 0 && h !== value) onCommit(h);
    else setText(String(value));
  };
  return (
    <input
      aria-label="Engine hours"
      type="number"
      inputMode="decimal"
      step="0.25"
      min={0}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={{ width: 76, fontSize: 17, padding: "8px 10px", border: "2px solid #d1d5db", borderRadius: 8, textAlign: "right" }}
    />
  );
}

export default function MachinePanel({
  lines,
  equipment,
  total,
  fuel,
  onChange,
  busy,
  canSave,
}: {
  lines: Line[];
  equipment: EquipmentOption[];
  total: number;
  fuel: HaulDetail["fuel"] | null;
  onChange: (uses: Use[]) => void;
  busy: boolean;
  canSave: boolean;
}) {
  const uses: Use[] = lines.map((l) => ({ equipmentId: l.equipmentId, hours: l.hours, basis: l.basis }));
  const unused = equipment.filter((e) => !lines.some((l) => l.equipmentId === e.id));

  const setHours = (id: string, hours: number) =>
    onChange(uses.map((u) => (u.equipmentId === id ? { ...u, hours } : u)).filter((u) => u.hours > 0));
  const remove = (id: string) => onChange(uses.filter((u) => u.equipmentId !== id));
  const add = (id: string) => {
    if (!id) return;
    onChange([...uses, { equipmentId: id, hours: 1, basis: "added by estimator" }]);
  };

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: `2px solid rgba(45,106,79,0.15)`, padding: 24, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🚜 Machine fuel</h3>
        <span style={{ fontSize: 22, fontWeight: 700, color: C.green }}>${fmt(total)}</span>
        {busy && <span style={{ fontSize: 14, color: C.grey }}>updating…</span>}
      </div>
      {fuel && <div style={{ fontSize: 14, color: C.grey, marginBottom: 12 }}>Off-road diesel: {fuel.offroad.label}</div>}

      {lines.length === 0 && (
        <p style={{ fontSize: 15, color: C.grey, margin: "0 0 12px" }}>No machines on this job. Add one below if it needs a skid steer or excavator.</p>
      )}

      <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
        {lines.map((l) => (
          <div key={l.equipmentId} style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b style={{ fontSize: 17, minWidth: 140 }}>{l.name}</b>
              <HoursInput value={l.hours} onCommit={(h) => setHours(l.equipmentId, h)} disabled={busy || !canSave} />
              <span style={{ fontSize: 15 }}>
                hr × {l.galPerHour} gal/hr × ${(l.centsPerGal / 100).toFixed(2)} {FUEL_WORD[l.fuel]}
              </span>
              <b style={{ marginLeft: "auto", fontSize: 17 }}>${fmt(l.cents / 100)}</b>
              <button
                type="button"
                aria-label={`Remove ${l.name}`}
                onClick={() => remove(l.equipmentId)}
                disabled={busy || !canSave}
                style={{ border: "none", background: "none", color: C.red, fontSize: 20, fontWeight: 700, cursor: "pointer", padding: "0 4px" }}
              >
                ✕
              </button>
            </div>
            {l.basis && <div style={{ fontSize: 13, color: C.grey, marginTop: 4 }}>{l.basis}</div>}
            {l.galPerHour === 0 && (
              <div style={{ fontSize: 13, color: "#8a5a00", marginTop: 4 }}>
                No fuel burn set for this machine — add gallons per hour in <Link href="/settings" style={{ color: C.green, fontWeight: 700 }}>Settings</Link>.
              </div>
            )}
          </div>
        ))}
      </div>

      {unused.length > 0 && canSave && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 16, fontWeight: 700 }}>
          + Add a machine:
          <select
            value=""
            disabled={busy}
            onChange={(e) => add(e.target.value)}
            style={{ fontSize: 16, padding: "8px 10px", border: "2px solid #d1d5db", borderRadius: 8, background: "#fff" }}
          >
            <option value="">Pick one…</option>
            {unused.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {equipment.length === 0 && (
        <p style={{ fontSize: 14, color: C.grey, margin: 0 }}>
          <Link href="/settings" style={{ color: C.green, fontWeight: 700 }}>Add your machines in Settings</Link> to have their fuel counted.
        </p>
      )}
    </div>
  );
}
