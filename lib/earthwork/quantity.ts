/**
 * Quantities from dimensions.
 *
 * The model is good at reading "a 3 in mulch bed along the 60 ft front walk,
 * about 4 ft deep" and bad at multiplying the result reliably. So when it can,
 * it returns the DIMENSIONS and this file does the multiplication, the
 * compaction allowance and the ton/yard conversion — the same move that took
 * tax and totals away from it.
 *
 * All outputs are thousandths (qtyMilli), like every other quantity in the app.
 */

import { toMilli } from "../money";
import { EARTH_FACTORS, earthKind, type EarthKind } from "./factors";

export interface Dims {
  /** Plan area, sq ft. Either this or length x width. */
  area_sqft?: number;
  length_ft?: number;
  width_ft?: number;
  /** Finished depth, inches. */
  depth_in?: number;
  /**
   * True when depth is a compacted/finished depth (base course, backfill).
   * False or absent for loose-laid material (mulch, decorative rock).
   * When absent, the material's kind decides.
   */
  compacted?: boolean;
}

export interface MaterialShape {
  name: string;
  category?: string;
  unit: string;
  /** From the catalog, thousandths of a ton per cu yd. Overrides defaults. */
  tonsPerCuYdMilli?: number | null;
}

export interface DimsResult {
  qtyMilli: number;
  /** Human-readable arithmetic, shown on the line. */
  basis: string;
  kind: EarthKind;
  /** Loose cubic yards before rounding, for gates and tests. */
  looseCuYd: number;
}

const INCREMENT_MILLI = 500; // suppliers sell bulk to the half yard / half ton

const fmt = (n: number, d = 2) => {
  const s = n.toFixed(d);
  // Trim trailing zeros after a decimal point only: "3.50" -> "3.5", "420" stays.
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

export function tonsPerCuYd(m: MaterialShape): number {
  if (m.tonsPerCuYdMilli && m.tonsPerCuYdMilli > 0) return m.tonsPerCuYdMilli / 1000;
  return EARTH_FACTORS[earthKind(m.name, m.category)].tonsPerCuYd;
}

/** Round a positive quantity UP to the next half unit. */
export function roundUpToIncrement(qtyMilli: number, inc = INCREMENT_MILLI): number {
  if (qtyMilli <= 0) return 0;
  return Math.ceil(qtyMilli / inc) * inc;
}

/**
 * Compute a bulk quantity from dimensions. Returns null when the dims are
 * incomplete or the material isn't sold by volume or weight — the caller then
 * keeps the model's own qty.
 */
export function qtyFromDims(dims: Dims | undefined | null, m: MaterialShape): DimsResult | null {
  if (!dims || typeof dims !== "object") return null;
  const unit = m.unit;
  const depth = num(dims.depth_in);

  let area = num(dims.area_sqft);
  let areaText = area ? `${fmt(area, 0)} sq ft` : "";
  if (!area) {
    const l = num(dims.length_ft);
    const w = num(dims.width_ft);
    if (l && w) {
      area = l * w;
      areaText = `${fmt(l, 1)} ft x ${fmt(w, 1)} ft`;
    }
  }
  if (!area) return null;

  const kind = earthKind(m.name, m.category);
  const f = EARTH_FACTORS[kind];

  // Area-sold materials: sod, pavers, fabric by the sq ft. 5% cut waste.
  if (unit === "sq ft") {
    const qty = Math.ceil(area * 1.05);
    return {
      qtyMilli: toMilli(qty),
      basis: `${areaText} + 5% cuts = ${qty} sq ft`,
      kind,
      looseCuYd: 0,
    };
  }

  if (unit !== "cu yd" && unit !== "ton") return null;
  if (!depth) return null;

  const inPlaceCuYd = (area * (depth / 12)) / 27;
  const compacted = dims.compacted ?? f.placeFactor > 1.0;
  const factor = compacted ? f.placeFactor : 1.0;
  const looseCuYd = inPlaceCuYd * factor;

  const parts = [`${areaText} at ${fmt(depth, 2)} in = ${fmt(inPlaceCuYd)} cu yd`];
  if (factor !== 1) {
    const word = kind === "topsoil" || kind === "fill" || kind === "compost" ? "settling" : "compaction";
    parts.push(`x ${fmt(factor)} ${word}`);
  }

  let raw: number;
  if (unit === "ton") {
    const tpy = tonsPerCuYd(m);
    raw = looseCuYd * tpy;
    parts.push(`x ${fmt(tpy)} ton/yd = ${fmt(raw)} ton`);
  } else {
    raw = looseCuYd;
    if (factor !== 1) parts.push(`= ${fmt(raw)} cu yd`);
  }

  const qtyMilli = roundUpToIncrement(toMilli(raw));
  parts.push(`-> order ${fmt(qtyMilli / 1000, 1)} ${unit}`);

  return { qtyMilli, basis: parts.join(" "), kind, looseCuYd };
}

/**
 * Convert a bulk quantity between cu yd and ton for a given material.
 * Returns null for any other unit pair.
 */
export function convertBulk(
  qtyMilli: number,
  from: string,
  to: string,
  m: MaterialShape
): number | null {
  if (from === to) return qtyMilli;
  const tpy = tonsPerCuYd(m);
  if (from === "cu yd" && to === "ton") return roundUpToIncrement(Math.round(qtyMilli * tpy));
  if (from === "ton" && to === "cu yd") return roundUpToIncrement(Math.round(qtyMilli / tpy));
  return null;
}

/** Tons and loose cubic yards for a bulk line — what the haul planner needs. */
export function bulkLoad(
  qtyMilli: number,
  unit: string,
  m: MaterialShape
): { tons: number; cuYd: number } | null {
  const q = qtyMilli / 1000;
  const tpy = tonsPerCuYd(m);
  if (unit === "ton") return { tons: q, cuYd: q / tpy };
  if (unit === "cu yd") return { tons: q * tpy, cuYd: q };
  return null;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
