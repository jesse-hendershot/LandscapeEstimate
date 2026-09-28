/**
 * Receipts, scale tickets and supplier price sheets -> catalog prices.
 *
 * The shop's real prices are on paper: a quarry's price list, scale tickets,
 * Menards receipts, yard invoices. Typing them in is the chore that keeps a
 * catalog stale. This reads a photo, PDF or pasted text and proposes updates,
 * each tied to the supplier it came from.
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

/**
 * A supplier's price list. Different from a receipt: no quantities, often a
 * product per line with a size, prices per ton or per yard, and the terms that
 * matter for hauling (delivery charges, minimums).
 */
export const SHEET_PROMPT = `You are reading a supplier's PRICE LIST — a quarry, sand & gravel pit, landscape yard or nursery — from a photo, a PDF, or pasted text.

Extract every product with a price. Return ONLY JSON, no prose:

{
  "supplier": { "name": "company and location as printed", "address": "address if printed, else empty", "phone": "phone if printed, else empty" },
  "date": "YYYY-MM-DD the prices take effect, if printed, else empty",
  "lines": [
    { "description": "product as printed, cleaned up, with its size (e.g. \"1 in clean limestone\")", "unit": "ton | cu yd | bag | each | sq ft | linear ft | roll | pack | bottle", "unitPrice": 23.50, "group": "one of the GROUPS below, or empty", "notes": "spec, size or anything printed next to it" }
  ],
  "delivery": { "text": "delivery terms exactly as printed, or empty", "flatFee": null, "minimum": "minimum order as printed, or empty" },
  "notes": "anything unclear"
}

GROUPS (what the product does on a job, so the shop can compare suppliers):
- drain_rock: clean washed stone about 3/4 to 1-1/2 in (#57, 1 in clean, 3/4 clean)
- base_rock: road stone, 3/4 in minus, class A, crusher run, dense grade
- pea_gravel
- river_rock: river rock, decorative stone, colored rock
- sand: concrete, mason, bedding or torpedo sand
- screenings: limestone screenings, fines, chips under 3/8 in
- rip_rap: rip rap, shot rock, boulders, 3 in and larger
- fill: fill dirt, clay, pit run
- topsoil: topsoil, black dirt, garden mix
- mulch
- other

Rules:
- unitPrice is the price PER UNIT for a customer picking up, before tax. If the sheet has several prices for one product (quantity breaks, pickup vs delivered, cash vs account), use the base pickup price and put the others in that line's notes.
- Keep per-ton and per-yard prices straight. If the sheet prices by the ton, the unit is ton.
- A delivery charge, fuel surcharge or minimum belongs in "delivery", not in "lines".
- If a number is unreadable, leave it out and say so in notes. Never invent a price.`;

export const GROUPS = [
  "drain_rock",
  "base_rock",
  "pea_gravel",
  "river_rock",
  "sand",
  "screenings",
  "rip_rap",
  "fill",
  "topsoil",
  "mulch",
  "other",
] as const;
export type Group = (typeof GROUPS)[number];

/**
 * Substitute-group labels a new material gets, so a Klein price and a Conklin
 * price for the same job land in the same group and get compared delivered.
 * Mulch and "other" get none: those aren't interchangeable by default.
 */
export const GROUP_LABEL: Record<Group, string> = {
  drain_rock: "Drain rock (clean, 3/4-1.5 in)",
  base_rock: "Base rock (3/4 in minus)",
  pea_gravel: "Pea gravel",
  river_rock: "River rock / decorative",
  sand: "Bedding sand",
  screenings: "Screenings / fines",
  rip_rap: "Rip rap",
  fill: "Fill dirt",
  topsoil: "Topsoil",
  mulch: "",
  other: "",
};

export interface ScannedLine {
  description: string;
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  /** Price sheets only. */
  group?: Group | "";
  notes?: string;
}

export interface ScanResult {
  supplier: { name: string; address: string; phone?: string };
  date: string;
  lines: ScannedLine[];
  notes: string;
  /** Price sheets: delivery terms as printed. */
  delivery?: { text: string; flatFee: number | null; minimum: string };
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
  const del = (r.delivery ?? {}) as Record<string, unknown>;
  return {
    supplier: {
      name: String(sup.name ?? "").trim(),
      address: String(sup.address ?? "").trim(),
      phone: String(sup.phone ?? "").trim().slice(0, 40),
    },
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? "")) ? String(r.date) : "",
    notes: String(r.notes ?? "").trim(),
    delivery: {
      text: String(del.text ?? "").trim().slice(0, 400),
      flatFee: num(del.flatFee),
      minimum: String(del.minimum ?? "").trim().slice(0, 120),
    },
    lines: lines
      .map((l) => l as Record<string, unknown>)
      .map((l) => {
        const qty = num(l.qty);
        const total = num(l.lineTotal);
        let unitPrice = num(l.unitPrice);
        if (unitPrice === null && qty && total) unitPrice = Math.round((total / qty) * 100) / 100;
        const g = String(l.group ?? "").trim().toLowerCase();
        return {
          description: String(l.description ?? "").trim().slice(0, 200),
          qty,
          unit: parseUnit(String(l.unit ?? "")),
          unitPrice,
          lineTotal: total,
          group: ((GROUPS as readonly string[]).includes(g) ? g : "") as Group | "",
          notes: String(l.notes ?? "").trim().slice(0, 200),
        };
      })
      .filter((l) => l.description)
      .slice(0, 120),
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
    /** Where the price being replaced came from. */
    priceSource: string;
    /** The match isn't tied to a supplier yet; applying links it to this one. */
    willLink: boolean;
  } | null;
  /** update = price change on a match; new = add to catalog; skip = unusable */
  action: "update" | "new" | "skip";
  /** Why a row is flagged, shown next to it. */
  flag: string;
  /**
   * Substitute group: the match's own, or the one suggested from the sheet so
   * this supplier's product is compared with the same thing from others.
   */
  specClass: string;
}

/** The account's own wording for a group if it already uses one, else ours. */
export function groupLabelFor(line: ScannedLine, catalog: Pick<Material, "specClass">[]): string {
  const want = line.group ? GROUP_LABEL[line.group] : "";
  if (!want) return "";
  const own = [...new Set(catalog.map((m) => m.specClass).filter(Boolean))];
  return own.find((c) => c.toLowerCase() === want.toLowerCase()) ?? own.find((c) => similarity(c, want) >= 0.75) ?? want;
}

/**
 * Propose what to do with each scanned line. A match needs a decent name
 * overlap AND the same unit — a ton price must never land on a cu yd row.
 *
 * When the supplier is known, the only candidates are that supplier's own
 * materials and ones not tied to any supplier yet: Klein's price must never
 * overwrite Conklin's row. (Klein's product becomes its own row in the same
 * substitute group, and estimates compare the two delivered.) Its own
 * materials win ties.
 */
export function propose(scan: ScanResult, catalog: Material[], supplierId: string | null): Proposal[] {
  // Only this supplier's own rows and rows no supplier owns yet. With no
  // supplier picked (a new one), nobody else's rows are candidates either:
  // one supplier's paper never reprices another's material.
  const pool = catalog.filter((m) => !m.supplierId || (supplierId !== null && m.supplierId === supplierId));
  return scan.lines.map((line) => {
    const specGuess = groupLabelFor(line, catalog);
    if (line.unitPrice === null) return { line, match: null, action: "skip", flag: "No readable price", specClass: specGuess };

    const scored = pool
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
        specClass: specGuess,
      };
    }

    const m = sameUnit.m;
    const current = m.unitCostCents / 100;
    const change = current > 0 ? (line.unitPrice - current) / current : 0;
    const starter = m.priceSource === "starter";
    return {
      line,
      match: {
        materialId: m.id,
        name: m.name,
        unit: m.unit,
        currentUnitCost: current,
        score: Math.round(Math.min(1, sameUnit.score) * 100) / 100,
        priceSource: m.priceSource ?? "manual",
        willLink: !m.supplierId,
      },
      action: "update",
      // A starter price is a guess; a big swing from it is expected, not suspicious.
      flag: !starter && Math.abs(change) > 0.5 ? `Price ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% — double-check` : "",
      specClass: m.specClass || specGuess,
    };
  });
}
