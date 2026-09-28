/**
 * Substitute ranking: pick the cheapest material ON THE GROUND, not on paper.
 *
 * Materials that do the same job share a `specClass` in the catalog — "Drain
 * rock (clean, 3/4-1.5 in)" might hold 3/4 clean limestone from one quarry, #57
 * from another, and 1 in washed river gravel from a third. The model picks one
 * member of the class; this file prices EVERY member delivered to this job and
 * keeps the cheapest, with the rest listed as alternatives the estimator can
 * swap in with one click.
 *
 * "Delivered" means material cost plus the marginal haul for that line from
 * that supplier. The shop round trip is excluded because it's identical for
 * every candidate and can't change the ranking.
 *
 * Which materials count as substitutes is the shop's call, made once in the
 * catalog. This file never invents an equivalence.
 *
 * A supplier's real price beats a starter placeholder. When the class has
 * members priced from a supplier's sheet, receipt or the shop's own entry,
 * a starter-priced member is never chosen over them, however cheap its
 * placeholder looks — it's still shown as an alternative, marked.
 */

import { bulkLoad, roundUpToIncrement, tonsPerCuYd, type MaterialShape } from "../earthwork/quantity";
import { extendCents, toMilli } from "../money";
import { bulkLineHaulCents, pickupTripCents, type HaulMode, type HaulSettings, type Truck } from "./plan";

export interface Candidate extends MaterialShape {
  id: string;
  unitCostCents: number;
  specClass: string;
  haul: string; // auto | dump | pickup | delivered | none
  supplierId: string | null;
  supplierName: string;
  deliveryFeeCents: number;
  /** starter | sheet | receipt | manual */
  priceSource?: string;
}

export interface Distance {
  miles: number;
  approx: boolean;
  /** Where the location came from, for the UI: "supplier", "town", "assumed". */
  basis: "supplier" | "town" | "assumed";
}

export interface RankContext {
  /** Road miles job -> supplier for a candidate, or null when unknown. */
  distanceFor: (c: Candidate) => Distance | null;
  /** Used when distanceFor returns null. */
  defaultMiles: number;
  dumpTrucks: Truck[];
  pickupTruck: Truck | null;
  settings: Pick<HaulSettings, "dieselCentsPerGal" | "avgMph" | "loadMinutes" | "pickupStopMinutes">;
  /** Suppliers already visited for other lines — a pickup there is free. */
  visitedSuppliers?: Set<string>;
  /** Minimum saving, in cents, before overriding the model's own pick. */
  switchThresholdCents?: number;
}

export interface Priced {
  materialId: string;
  name: string;
  supplierName: string;
  supplierId: string | null;
  unit: string;
  qtyMilli: number;
  unitCostCents: number;
  materialCents: number;
  haulCents: number;
  landedCents: number;
  mode: HaulMode;
  miles: number | null;
  distance: Distance | null;
  loads: number;
  isModelPick: boolean;
  priceSource: string;
}

export interface RankResult {
  chosen: Priced;
  alternatives: Priced[];
  /** Cents saved versus the model's own pick; 0 when the pick won. */
  savedCents: number;
  switched: boolean;
  /** Why it switched: cheaper delivered, or a real supplier price replacing a placeholder. */
  reason: "cheaper" | "supplier_price" | null;
}

export function haulModeFor(c: Pick<Candidate, "haul" | "unit">): HaulMode {
  const h = (c.haul || "auto").toLowerCase();
  if (h === "dump" || h === "pickup" || h === "delivered" || h === "none") return h;
  return c.unit === "ton" || c.unit === "cu yd" ? "dump" : "pickup";
}

/**
 * Quantity of candidate `c` that does the same job as `qtyMilli` of `picked`.
 * Same unit: unchanged. Bulk to bulk: converted through loose volume using
 * each material's own density. Anything else: not comparable (null).
 */
export function equivalentQty(picked: MaterialShape, qtyMilli: number, c: MaterialShape): number | null {
  if (picked.unit === c.unit) return qtyMilli;
  const bulk = (u: string) => u === "ton" || u === "cu yd";
  if (!bulk(picked.unit) || !bulk(c.unit)) return null;

  // picked -> loose cu yd (by picked's density) -> c's unit (by c's density),
  // rounded once at the end so two conversions don't round up twice.
  const yards = picked.unit === "cu yd" ? qtyMilli / 1000 : qtyMilli / 1000 / tonsPerCuYd(picked);
  const target = c.unit === "cu yd" ? yards : yards * tonsPerCuYd(c);
  return roundUpToIncrement(toMilli(target));
}

export function priceCandidate(
  c: Candidate,
  qtyMilli: number,
  ctx: RankContext,
  isModelPick: boolean
): Priced {
  const mode = haulModeFor(c);
  const materialCents = extendCents(qtyMilli, c.unitCostCents);
  const distance = ctx.distanceFor(c);
  const miles = distance ? distance.miles : null;
  const useMiles = miles ?? ctx.defaultMiles;

  let haulCents = 0;
  let loads = 0;
  if (mode === "dump") {
    const bl = bulkLoad(qtyMilli, c.unit, c);
    if (bl && ctx.dumpTrucks.length > 0) {
      const r = bulkLineHaulCents(bl.tons, bl.cuYd, useMiles, ctx.dumpTrucks, ctx.settings);
      haulCents = r.cents;
      loads = r.loads;
    }
  } else if (mode === "pickup") {
    const visited = c.supplierId && ctx.visitedSuppliers?.has(c.supplierId);
    if (!visited && ctx.pickupTruck) {
      haulCents = pickupTripCents(useMiles, ctx.pickupTruck, ctx.settings);
      loads = 1;
    }
  } else if (mode === "delivered") {
    haulCents = Math.max(0, c.deliveryFeeCents || 0);
  }

  return {
    materialId: c.id,
    name: c.name,
    supplierName: c.supplierName,
    supplierId: c.supplierId,
    unit: c.unit,
    qtyMilli,
    unitCostCents: c.unitCostCents,
    materialCents,
    haulCents,
    landedCents: materialCents + haulCents,
    mode,
    miles,
    distance: distance ?? (mode === "dump" || mode === "pickup"
      ? { miles: ctx.defaultMiles, approx: true, basis: "assumed" }
      : null),
    loads,
    isModelPick,
    priceSource: c.priceSource ?? "manual",
  };
}

/**
 * Rank a model-picked material against its substitute class.
 *
 * `pool` is the whole active catalog; members of the picked material's class
 * are drawn from it. A material with no class is still priced (so its haul is
 * known) but has no alternatives.
 */
export function rankSubstitutes(
  picked: Candidate,
  qtyMilli: number,
  pool: Candidate[],
  ctx: RankContext
): RankResult {
  const threshold = ctx.switchThresholdCents ?? 500;
  const self = priceCandidate(picked, qtyMilli, ctx, true);

  const cls = picked.specClass.trim().toLowerCase();
  if (!cls) return { chosen: self, alternatives: [], savedCents: 0, switched: false, reason: null };

  const others: Priced[] = [];
  for (const c of pool) {
    if (c.id === picked.id) continue;
    if (c.specClass.trim().toLowerCase() !== cls) continue;
    const q = equivalentQty(picked, qtyMilli, c);
    if (q === null || q <= 0) continue;
    others.push(priceCandidate(c, q, ctx, false));
  }

  const all = [self, ...others].sort((a, b) => a.landedCents - b.landedCents);
  const isReal = (p: Priced) => p.priceSource !== "starter";
  const real = all.filter(isReal);

  let chosen = self;
  let reason: RankResult["reason"] = null;
  if (!isReal(self) && real.length > 0) {
    // The pick is a placeholder and a supplier price exists: use the supplier's.
    chosen = real[0];
    reason = "supplier_price";
  } else {
    const best = (real.length > 0 ? real : all)[0];
    if (best !== self && self.landedCents - best.landedCents >= threshold) {
      chosen = best;
      reason = "cheaper";
    }
  }
  const switched = chosen !== self;

  return {
    chosen,
    alternatives: all.filter((p) => p !== chosen).slice(0, 4),
    savedCents: switched ? Math.max(0, self.landedCents - chosen.landedCents) : 0,
    switched,
    reason,
  };
}
