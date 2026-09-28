/**
 * Live totals on the estimate screen, while the estimator edits.
 *
 * Mirrors the server's arithmetic (lib/estimate/build.ts computeTotals) in
 * cents, so the number on screen while typing is the number the server saves.
 * Hauling and deposits come from the last server response — they depend on
 * trucks and distances the browser doesn't have — and refresh on autosave.
 */

import type { LineItem } from "@/lib/estimate/schema";

const toCents = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
const toMilli = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 1000);
const extend = (qty: number, dollars: number) => Math.round((toMilli(qty) * toCents(dollars)) / 1000);
const bps = (cents: number, pct: number) => Math.round((cents * Math.round(pct * 100)) / 10000);

export interface Bottom {
  haul: number;
  haulLabel: string;
  haulComputed: boolean;
  deposit: number;
  depositLabel: string;
}

export interface Totals {
  subLow: number;
  subHigh: number;
  haul: number;
  deposit: number;
  taxLow: number;
  taxHigh: number;
  grandLow: number;
  grandHigh: number;
}

export function computeTotals(
  items: LineItem[],
  bottom: Bottom,
  tax: { ratePct: number; haul: boolean; deposits: boolean }
): Totals {
  let subLow = 0;
  let subHigh = 0;
  for (const i of items) {
    subLow += extend(i.qty, i.low);
    subHigh += extend(i.qty, Math.max(i.low, i.high));
  }
  const haul = toCents(bottom.haul);
  const deposit = toCents(bottom.deposit);
  const extra = (tax.haul ? haul : 0) + (tax.deposits ? deposit : 0);
  const taxLow = bps(subLow + extra, tax.ratePct);
  const taxHigh = bps(subHigh + extra, tax.ratePct);
  return {
    subLow: subLow / 100,
    subHigh: subHigh / 100,
    haul: haul / 100,
    deposit: deposit / 100,
    taxLow: taxLow / 100,
    taxHigh: taxHigh / 100,
    grandLow: (subLow + haul + deposit + taxLow) / 100,
    grandHigh: (subHigh + haul + deposit + taxHigh) / 100,
  };
}

/** Pull the computed bottom rows out of a server line_items array. */
export function bottomFrom(lineItems: LineItem[]): Bottom {
  const haul = lineItems.find((i) => i.kind === "haul" || (!i.kind && /delivery|hauling/i.test(i.material)));
  const dep = lineItems.find((i) => i.kind === "deposit" || (!i.kind && /pallet deposit/i.test(i.material)));
  return {
    haul: haul ? haul.qty * haul.low : 0,
    haulLabel: haul?.source ?? "",
    haulComputed: Boolean(haul && /hauling/i.test(haul.material)),
    deposit: dep ? dep.qty * dep.low : 0,
    depositLabel: dep?.source ?? "",
  };
}

export const isMaterialRow = (i: LineItem) =>
  i.kind ? i.kind === "material" : !/delivery|hauling|pallet deposit|sales.?tax|iowa.*tax|grand.?total/i.test(i.material);

export const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
