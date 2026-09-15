/**
 * Estimate assembly.
 *
 * This is where the model's output stops being trusted and starts being
 * arithmetic. Three rules govern everything here:
 *
 * 1. **A catalog line is priced from the catalog, full stop.** The model
 *    returns a catalog id and a quantity. It never sees the price and never
 *    supplies one, so a catalog price cannot be wrong on an estimate unless it
 *    is wrong in the catalog — where exactly one person can fix it, once, for
 *    every future job.
 *
 * 2. **Delivery, tax and the grand total are computed, never requested.** The
 *    old flow asked the model for them and then checked its arithmetic. Not
 *    asking is strictly better than checking.
 *
 * 3. **Integers throughout.** Cents and thousandths. No float touches a number
 *    a contractor reads.
 */

import type { Material } from "../db/schema";
import { applyBps, extendCents, fromCents, fromMilli, toCents, toMilli } from "../money";
import { parseUnit, type LineItem } from "./schema";

// ── what the model is allowed to return ────────────────────────────────────

export interface ModelCatalogLine {
  catalogId: string;
  qty: number;
  /** Why this quantity — shown to the estimator, never used in arithmetic. */
  basis?: string;
}

export interface ModelCustomLine {
  name: string;
  unit: string;
  qty: number;
  low: number;
  high: number;
  source: string;
  basis?: string;
}

export interface ModelOutput {
  catalog_lines?: ModelCatalogLine[];
  custom_lines?: ModelCustomLine[];
  delivery?: { low: number; high: number; source?: string };
  clarifications_needed?: string[];
  notes?: string;
}

// ── assembled result ───────────────────────────────────────────────────────

export interface BuiltLine {
  material: string;
  qtyMilli: number;
  unit: string;
  unitLowCents: number;
  unitHighCents: number;
  source: string;
  fromCatalog: boolean;
  materialId: string | null;
  basis: string;
}

export interface BuiltEstimate {
  lines: BuiltLine[];
  subtotalLowCents: number;
  subtotalHighCents: number;
  deliveryLowCents: number;
  deliveryHighCents: number;
  taxLowCents: number;
  taxHighCents: number;
  totalLowCents: number;
  totalHighCents: number;
  clarifications: string[];
  notes: string;
  /** Model-supplied ids that matched nothing in this account's catalog. */
  droppedCatalogIds: string[];
  catalogLineCount: number;
  customLineCount: number;
}

export interface BuildOptions {
  taxRateBps: number;
  /** Applied to material rows only; delivery and tax are never marked up. */
  markupBps?: number;
}

/**
 * Assemble a model response into a priced estimate.
 *
 * Unknown catalog ids are dropped and reported rather than guessed at. A model
 * that hallucinates a uuid must not be able to invent a line with no price.
 */
export function buildEstimate(
  output: ModelOutput,
  catalog: Material[],
  opts: BuildOptions
): BuiltEstimate {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const lines: BuiltLine[] = [];
  const dropped: string[] = [];

  const markup = opts.markupBps ?? 0;
  const withMarkup = (cents: number) => (markup ? cents + applyBps(cents, markup) : cents);

  for (const raw of output.catalog_lines ?? []) {
    const m = byId.get(raw?.catalogId);
    if (!m) {
      if (raw?.catalogId) dropped.push(raw.catalogId);
      continue;
    }
    const qtyMilli = toMilli(raw.qty);
    if (qtyMilli <= 0) continue;

    // Catalog price, verbatim. Low and high are identical because this is a
    // known price, not a researched range — that certainty is the point.
    const unit = withMarkup(m.unitCostCents);
    lines.push({
      material: m.name,
      qtyMilli,
      unit: m.unit,
      unitLowCents: unit,
      unitHighCents: unit,
      source: m.supplier
        ? [m.supplier, m.supplierLocation].filter(Boolean).join(" – ")
        : "Your catalog",
      fromCatalog: true,
      materialId: m.id,
      basis: raw.basis ?? "",
    });
  }

  for (const raw of output.custom_lines ?? []) {
    if (!raw?.name) continue;
    const qtyMilli = toMilli(raw.qty);
    if (qtyMilli <= 0) continue;

    let low = toCents(raw.low);
    let high = toCents(raw.high);
    if (low > high) [low, high] = [high, low]; // model inverted the range
    if (high <= 0) continue;

    lines.push({
      material: raw.name,
      qtyMilli,
      unit: parseUnit(raw.unit) ?? raw.unit,
      unitLowCents: withMarkup(low),
      unitHighCents: withMarkup(high),
      source: raw.source ?? "",
      fromCatalog: false,
      materialId: null,
      basis: raw.basis ?? "",
    });
  }

  // ── computed bottom line ─────────────────────────────────────────────────

  let subLow = 0;
  let subHigh = 0;
  for (const l of lines) {
    subLow += extendCents(l.qtyMilli, l.unitLowCents);
    subHigh += extendCents(l.qtyMilli, l.unitHighCents);
  }

  // Delivery is a pass-through cost, so it is not marked up.
  let delLow = toCents(output.delivery?.low);
  let delHigh = toCents(output.delivery?.high);
  if (delLow > delHigh) [delLow, delHigh] = [delHigh, delLow];

  // Tax applies to materials, not to delivery. Computing it here is the whole
  // reason the tax gate can be deleted.
  const taxLow = applyBps(subLow, opts.taxRateBps);
  const taxHigh = applyBps(subHigh, opts.taxRateBps);

  return {
    lines,
    subtotalLowCents: subLow,
    subtotalHighCents: subHigh,
    deliveryLowCents: delLow,
    deliveryHighCents: delHigh,
    taxLowCents: taxLow,
    taxHighCents: taxHigh,
    totalLowCents: subLow + delLow + taxLow,
    totalHighCents: subHigh + delHigh + taxHigh,
    clarifications: Array.isArray(output.clarifications_needed)
      ? output.clarifications_needed.filter((c) => typeof c === "string").slice(0, 12)
      : [],
    notes: typeof output.notes === "string" ? output.notes : "",
    droppedCatalogIds: dropped,
    catalogLineCount: lines.filter((l) => l.fromCatalog).length,
    customLineCount: lines.filter((l) => !l.fromCatalog).length,
  };
}

/**
 * Render to the LineItem[] shape app/page.tsx already renders.
 *
 * The three bottom-line rows are appended here so the existing table, PDF
 * export and markup logic keep working untouched — but unlike before, they are
 * computed values rather than something a model wrote down.
 */
export function toLineItems(built: BuiltEstimate, taxRateBps: number): LineItem[] {
  const items: LineItem[] = built.lines.map((l) => ({
    material: l.material,
    qty: fromMilli(l.qtyMilli),
    unit: l.unit,
    low: fromCents(l.unitLowCents),
    high: fromCents(l.unitHighCents),
    source: l.source,
  }));

  if (built.deliveryLowCents > 0 || built.deliveryHighCents > 0) {
    items.push({
      material: "Delivery (estimated)",
      qty: 1,
      unit: "total",
      low: fromCents(built.deliveryLowCents),
      high: fromCents(built.deliveryHighCents),
      source: "Local supplier delivery",
    });
  }

  items.push({
    material: `Iowa Sales Tax (${(taxRateBps / 100).toFixed(taxRateBps % 100 === 0 ? 0 : 2)}%)`,
    qty: 1,
    unit: "total",
    low: fromCents(built.taxLowCents),
    high: fromCents(built.taxHighCents),
    source: "Iowa state sales tax",
  });

  items.push({
    material: "GRAND TOTAL",
    qty: 1,
    unit: "total",
    low: fromCents(built.totalLowCents),
    high: fromCents(built.totalHighCents),
    source: "—",
  });

  return items;
}
