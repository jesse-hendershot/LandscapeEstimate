/**
 * Estimate assembly.
 *
 * This is where the model's output stops being trusted and starts being
 * arithmetic. Four rules govern everything here:
 *
 * 1. **A catalog line is priced from the catalog, full stop.** The model
 *    returns a catalog id and a quantity. It never sees the price and never
 *    supplies one, so a catalog price cannot be wrong on an estimate unless it
 *    is wrong in the catalog — where exactly one person can fix it, once, for
 *    every future job.
 *
 * 2. **Hauling, deposits, tax and the grand total are computed, never
 *    requested.** Hauling comes from the locality engine (lib/haul) when the
 *    shop has trucks set up; the model's delivery guess is only a fallback.
 *
 * 3. **When the model gives dimensions, code does the multiplying.** A line
 *    can carry `dims` (area, depth, compacted?) instead of trusting the model's
 *    own qty. See lib/earthwork.
 *
 * 4. **Integers throughout.** Cents and thousandths. No float touches a number
 *    a contractor reads.
 */

import type { Material } from "../db/schema";
import { qtyFromDims, type Dims } from "../earthwork/quantity";
import { applyBps, extendCents, fromCents, fromMilli, toCents, toMilli } from "../money";
import { parseUnit, type LineItem, type LineAlternative } from "./schema";

// ── what the model is allowed to return ────────────────────────────────────

export interface ModelCatalogLine {
  catalogId: string;
  qty: number;
  /** Why this quantity — shown to the estimator, never used in arithmetic. */
  basis?: string;
  /** When given, the quantity is computed from these instead of `qty`. */
  dims?: Dims;
}

export interface ModelCustomLine {
  name: string;
  unit: string;
  qty: number;
  low: number;
  high: number;
  source: string;
  basis?: string;
  dims?: Dims;
}

export interface ModelOutput {
  catalog_lines?: ModelCatalogLine[];
  custom_lines?: ModelCustomLine[];
  delivery?: { low: number; high: number; source?: string };
  /** Engine hours for the shop's own machines, by equipment id. */
  machines?: { equipmentId: string; hours: number; basis?: string }[];
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
  /** Filled in by the locality engine. */
  haulCents?: number;
  miles?: number | null;
  milesApprox?: boolean;
  supplierId?: string | null;
  alternatives?: LineAlternative[];
  /** Set when a substitute replaced the model's pick; what it saved, delivered. */
  savedCents?: number;
  replaced?: string;
  /**
   * Where the unit price came from: starter | sheet | receipt | manual for
   * catalog lines, "research" for lines the model priced from the web.
   */
  priceSource?: string;
  /** "Conklin Quarry price sheet, 2026-09-29" */
  priceLabel?: string;
}

export interface DepositLine {
  material: string;
  pallets: number;
  cents: number;
}

export interface QtyMismatch {
  material: string;
  modelQtyMilli: number;
  computedQtyMilli: number;
  unit: string;
}

export interface BuiltEstimate {
  lines: BuiltLine[];
  subtotalLowCents: number;
  subtotalHighCents: number;
  /** Hauling/delivery. Named "delivery" for the database column's sake. */
  deliveryLowCents: number;
  deliveryHighCents: number;
  /** "computed" = locality engine; "model" = the model's guess; "none". */
  haulSource: "computed" | "model" | "none";
  haulLabel: string;
  /** Fuel the machines burn on site. Taxed along with hauling. */
  machineCents: number;
  machineLabel: string;
  depositCents: number;
  deposits: DepositLine[];
  taxLowCents: number;
  taxHighCents: number;
  totalLowCents: number;
  totalHighCents: number;
  clarifications: string[];
  notes: string;
  /** Model-supplied ids that matched nothing in this account's catalog. */
  droppedCatalogIds: string[];
  qtyMismatches: QtyMismatch[];
  catalogLineCount: number;
  customLineCount: number;
}

export interface BuildOptions {
  taxRateBps: number;
  /** Applied to material rows only; hauling, deposits and tax are never marked up. */
  markupBps?: number;
  /** Tax hauling too. Defaults to false here; the profile decides in the app. */
  taxHaul?: boolean;
  /** Tax refundable deposits too. */
  taxDeposits?: boolean;
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
  const mismatches: QtyMismatch[] = [];

  const markup = opts.markupBps ?? 0;
  const withMarkup = (cents: number) => (markup ? cents + applyBps(cents, markup) : cents);

  const resolveQty = (
    name: string,
    unit: string,
    rawQty: unknown,
    basis: string,
    dims: Dims | undefined,
    shape: { category?: string; tonsPerCuYdMilli?: number | null }
  ): { qtyMilli: number; basis: string } => {
    let qtyMilli = toMilli(rawQty as number);
    let why = basis;
    const computed = qtyFromDims(dims, { name, unit, ...shape });
    if (computed && computed.qtyMilli > 0) {
      if (qtyMilli > 0 && Math.abs(computed.qtyMilli - qtyMilli) / computed.qtyMilli > 0.25) {
        mismatches.push({ material: name, modelQtyMilli: qtyMilli, computedQtyMilli: computed.qtyMilli, unit });
      }
      qtyMilli = computed.qtyMilli;
      why = computed.basis + (basis ? ` — ${basis}` : "");
    }
    return { qtyMilli, basis: why };
  };

  for (const raw of output.catalog_lines ?? []) {
    const m = byId.get(raw?.catalogId);
    if (!m) {
      if (raw?.catalogId) dropped.push(raw.catalogId);
      continue;
    }
    const { qtyMilli, basis } = resolveQty(m.name, m.unit, raw.qty, raw.basis ?? "", raw.dims, {
      category: m.category,
      tonsPerCuYdMilli: m.tonsPerCuYdMilli,
    });
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
      supplierId: m.supplierId ?? null,
      basis,
      priceSource: m.priceSource ?? "manual",
      priceLabel: m.priceSourceLabel ?? "",
    });
  }

  for (const raw of output.custom_lines ?? []) {
    if (!raw?.name) continue;
    const unitName = parseUnit(raw.unit) ?? raw.unit;
    const { qtyMilli, basis } = resolveQty(raw.name, unitName, raw.qty, raw.basis ?? "", raw.dims, {});
    if (qtyMilli <= 0) continue;

    let low = toCents(raw.low);
    let high = toCents(raw.high);
    if (low > high) [low, high] = [high, low]; // model inverted the range
    if (high <= 0) continue;

    lines.push({
      material: raw.name,
      qtyMilli,
      unit: unitName,
      unitLowCents: withMarkup(low),
      unitHighCents: withMarkup(high),
      source: raw.source ?? "",
      fromCatalog: false,
      materialId: null,
      basis,
      priceSource: "research",
      priceLabel: "Looked up online — not from your suppliers",
    });
  }

  // Delivery is a pass-through cost, so it is not marked up.
  let delLow = toCents(output.delivery?.low);
  let delHigh = toCents(output.delivery?.high);
  if (delLow > delHigh) [delLow, delHigh] = [delHigh, delLow];

  const built: BuiltEstimate = {
    lines,
    subtotalLowCents: 0,
    subtotalHighCents: 0,
    deliveryLowCents: delLow,
    deliveryHighCents: delHigh,
    haulSource: delHigh > 0 ? "model" : "none",
    haulLabel: output.delivery?.source ? `Delivery (estimated) — ${output.delivery.source}` : "Delivery (estimated)",
    machineCents: 0,
    machineLabel: "",
    depositCents: 0,
    deposits: [],
    taxLowCents: 0,
    taxHighCents: 0,
    totalLowCents: 0,
    totalHighCents: 0,
    clarifications: Array.isArray(output.clarifications_needed)
      ? output.clarifications_needed.filter((c) => typeof c === "string").slice(0, 12)
      : [],
    notes: typeof output.notes === "string" ? stripIds(output.notes) : "",
    droppedCatalogIds: dropped,
    qtyMismatches: mismatches,
    catalogLineCount: lines.filter((l) => l.fromCatalog).length,
    customLineCount: lines.filter((l) => !l.fromCatalog).length,
  };

  return computeTotals(built, opts);
}

/**
 * Recompute the bottom line from the lines, hauling and deposits.
 *
 * Called by buildEstimate and again after the locality engine swaps in
 * substitutes and sets the haul. Pure: returns a new object.
 */
export function computeTotals(b: BuiltEstimate, opts: BuildOptions): BuiltEstimate {
  let subLow = 0;
  let subHigh = 0;
  for (const l of b.lines) {
    subLow += extendCents(l.qtyMilli, l.unitLowCents);
    subHigh += extendCents(l.qtyMilli, l.unitHighCents);
  }

  // Machine fuel is taxed exactly like hauling: both are the shop's running
  // costs passed through on the quote.
  const machine = b.machineCents ?? 0;
  const haulLowBase = opts.taxHaul ? b.deliveryLowCents + machine : 0;
  const haulHighBase = opts.taxHaul ? b.deliveryHighCents + machine : 0;
  const depBase = opts.taxDeposits ? b.depositCents : 0;

  const taxLow = applyBps(subLow + haulLowBase + depBase, opts.taxRateBps);
  const taxHigh = applyBps(subHigh + haulHighBase + depBase, opts.taxRateBps);

  return {
    ...b,
    subtotalLowCents: subLow,
    subtotalHighCents: subHigh,
    taxLowCents: taxLow,
    taxHighCents: taxHigh,
    machineCents: machine,
    machineLabel: b.machineLabel ?? "",
    totalLowCents: subLow + b.deliveryLowCents + machine + b.depositCents + taxLow,
    totalHighCents: subHigh + b.deliveryHighCents + machine + b.depositCents + taxHigh,
    catalogLineCount: b.lines.filter((l) => l.fromCatalog).length,
    customLineCount: b.lines.filter((l) => !l.fromCatalog).length,
  };
}

/**
 * Pallet deposits for the catalog lines that come on pallets.
 * Pallets are whole: 520 sq ft of sod on 450 sq ft pallets is 2 pallets.
 */
export function computeDeposits(lines: BuiltLine[], catalog: Material[]): DepositLine[] {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const out: DepositLine[] = [];
  for (const l of lines) {
    if (!l.materialId) continue;
    const m = byId.get(l.materialId);
    if (!m || !m.unitsPerPalletMilli || m.unitsPerPalletMilli <= 0 || m.palletDepositCents <= 0) continue;
    const pallets = Math.ceil(l.qtyMilli / m.unitsPerPalletMilli);
    if (pallets <= 0) continue;
    out.push({ material: m.name, pallets, cents: pallets * m.palletDepositCents });
  }
  return out;
}

/** The model sometimes quotes catalog uuids in its notes; nobody wants to read those. */
export function stripIds(text: string): string {
  return text
    .replace(/\s*\((?:catalog\s*)?id\s*[:#]?\s*[0-9a-f-]{8,36}\)/gi, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const TAX_LABEL = (bps: number) =>
  `Sales Tax (${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%)`;

/**
 * Render to the LineItem[] shape the estimate screen renders.
 *
 * The bottom-line rows are appended here — computed values, never something a
 * model wrote down.
 */
export function toLineItems(built: BuiltEstimate, taxRateBps: number, opts: Pick<BuildOptions, "taxHaul" | "taxDeposits"> = {}): LineItem[] {
  const items: LineItem[] = built.lines.map((l) => ({
    material: l.material,
    qty: fromMilli(l.qtyMilli),
    unit: l.unit,
    low: fromCents(l.unitLowCents),
    high: fromCents(l.unitHighCents),
    source: l.source,
    kind: "material",
    materialId: l.materialId,
    fromCatalog: l.fromCatalog,
    basis: l.basis,
    haul: l.haulCents !== undefined ? fromCents(l.haulCents) : undefined,
    miles: l.miles ?? null,
    milesApprox: l.milesApprox,
    alternatives: l.alternatives,
    saved: l.savedCents ? fromCents(l.savedCents) : undefined,
    replaced: l.replaced,
    priceSource: l.priceSource,
    priceLabel: l.priceLabel,
  }));

  if (built.deliveryLowCents > 0 || built.deliveryHighCents > 0) {
    items.push({
      material: built.haulSource === "computed" ? "Hauling & delivery" : "Delivery (estimated)",
      qty: 1,
      unit: "total",
      low: fromCents(built.deliveryLowCents),
      high: fromCents(built.deliveryHighCents),
      source: built.haulLabel,
      kind: "haul",
    });
  }

  if ((built.machineCents ?? 0) > 0) {
    items.push({
      material: "Machine fuel",
      qty: 1,
      unit: "total",
      low: fromCents(built.machineCents),
      high: fromCents(built.machineCents),
      source: built.machineLabel,
      kind: "machine",
    });
  }

  if (built.depositCents > 0) {
    items.push({
      material: "Pallet deposits (refundable)",
      qty: 1,
      unit: "total",
      low: fromCents(built.depositCents),
      high: fromCents(built.depositCents),
      source: built.deposits.map((d) => `${d.pallets} pallet${d.pallets === 1 ? "" : "s"} — ${d.material}`).join("; "),
      kind: "deposit",
    });
  }

  const scope = [
    "materials",
    opts.taxHaul ? ((built.machineCents ?? 0) > 0 ? "hauling + machine fuel" : "hauling") : "",
    opts.taxDeposits ? "deposits" : "",
  ]
    .filter(Boolean)
    .join(" + ");
  items.push({
    material: TAX_LABEL(taxRateBps),
    qty: 1,
    unit: "total",
    low: fromCents(built.taxLowCents),
    high: fromCents(built.taxHighCents),
    source: `On ${scope}`,
    kind: "tax",
  });

  items.push({
    material: "GRAND TOTAL",
    qty: 1,
    unit: "total",
    low: fromCents(built.totalLowCents),
    high: fromCents(built.totalHighCents),
    source: "—",
    kind: "total",
  });

  return items;
}
