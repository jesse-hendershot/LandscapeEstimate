/**
 * Receipts and scale tickets -> catalog prices.
 *
 * The shop's real prices are on paper: scale tickets from the quarry, Menards
 * receipts, yard invoices. Typing them in is the chore that keeps a catalog
 * stale. This reads a photo of one and proposes updates.
 *
 * The model READS; a person APPROVES. Nothing here writes a price. The review
 * screen shows each proposed change next to the current price, and only the
 * rows the estimator ticks are applied. That keeps the catalog's rule intact:
 * no price in it was ever guessed by a model.
 */

import type { Material } from "../db/schema";
import { parseUnit } from "../estimate/schema";

export const SCAN_PROMPT = `You are reading a photo of a receipt, invoice or scale ticket from a landscaping supplier (a quarry, a landscape yard, a big-box store, a nursery).

Extract every purchased material line. Return ONLY JSON, no prose:

{
  "supplier": { "name": "store or quarry name as printed", "address": "address if printed, else empty" },
  "date": "YYYY-MM-DD if printed, else empty",
  "lines": [
    { "description": "item as printed, cleaned up", "qty": 12.34, "unit": "ton | cu yd | bag | each | sq ft | linear ft | roll | pack | bottle", "unitPrice": 23.50, "lineTotal": 290.00 }
  ],
  "notes": "anything unclear, e.g. a smudged price"
}

Rules:
- unitPrice is the price PER UNIT before tax. If only a line total and quantity are printed, divide.
- Scale tickets: the unit is usually ton (net weight). Use the NET weight, not gross.
- Skip tax, delivery/fuel surcharges, deposits and totals as lines — but mention a delivery or pallet deposit charge in notes.
- If a number is unreadable, leave it out and say so in notes. Never invent a price.`;

export interface ScannedLine {
  description: string;
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
}

export interface ScanResult {
  supplier: { name: string; address: string };
  date: string;
  lines: ScannedLine[];
  notes: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v.replace(/[$,\s]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Defensive parse of the model's JSON. */
export function normalizeScan(raw: unknown): ScanResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sup = (r.supplier ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines : [];
  return {
    supplier: { name: String(sup.name ?? "").trim(), address: String(sup.address ?? "").trim() },
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? "")) ? String(r.date) : "",
    notes: String(r.notes ?? "").trim(),
    lines: lines
      .map((l) => l as Record<string, unknown>)
      .map((l) => {
        const qty = num(l.qty);
        const total = num(l.lineTotal);
        let unitPrice = num(l.unitPrice);
        if (unitPrice === null && qty && total) unitPrice = Math.round((total / qty) * 100) / 100;
        return {
          description: String(l.description ?? "").trim().slice(0, 200),
          qty,
          unit: parseUnit(String(l.unit ?? "")),
          unitPrice,
          lineTotal: total,
        };
      })
      .filter((l) => l.description)
      .slice(0, 60),
  };
}

// ── matching a receipt line to a catalog material ─────────────────────────

const STOP = new Set(["the", "and", "of", "a", "in", "bulk", "per", "x", "w", "with", "lb", "lbs", "ft", "cu", "yd"]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2")
    .replace(/[^a-z0-9/#.]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/\.$/, ""))
    .filter((t) => t && !STOP.has(t));
}

/** Overlap score in [0, 1]: shared tokens / tokens in the shorter name. */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export interface Proposal {
  line: ScannedLine;
  match: {
    materialId: string;
    name: string;
    unit: string;
    currentUnitCost: number;
    score: number;
  } | null;
  /** update = price change on a match; new = add to catalog; skip = unusable */
  action: "update" | "new" | "skip";
  /** Why a row is flagged, shown next to it. */
  flag: string;
}

/**
 * Propose what to do with each scanned line. A match needs a decent name
 * overlap AND the same unit — a ton price must never land on a cu yd row.
 * When the supplier is known, its own materials win ties.
 */
export function propose(scan: ScanResult, catalog: Material[], supplierId: string | null): Proposal[] {
  return scan.lines.map((line) => {
    if (line.unitPrice === null) return { line, match: null, action: "skip", flag: "No readable price" };

    const scored = catalog
      .map((m) => {
        let score = similarity(line.description, m.name);
        if (supplierId && m.supplierId === supplierId) score += 0.15;
        return { m, score };
      })
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score);

    const sameUnit = scored.find((x) => !line.unit || x.m.unit === line.unit);
    if (!sameUnit) {
      const near = scored[0];
      return {
        line,
        match: null,
        action: "new",
        flag: near ? `Similar to "${near.m.name}" but that's priced per ${near.m.unit}` : "",
      };
    }

    const current = sameUnit.m.unitCostCents / 100;
    const change = current > 0 ? (line.unitPrice - current) / current : 0;
    return {
      line,
      match: {
        materialId: sameUnit.m.id,
        name: sameUnit.m.name,
        unit: sameUnit.m.unit,
        currentUnitCost: current,
        score: Math.round(Math.min(1, sameUnit.score) * 100) / 100,
      },
      action: "update",
      flag: Math.abs(change) > 0.5 ? `Price ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% — double-check` : "",
    };
  });
}
