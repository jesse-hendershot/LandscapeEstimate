/**
 * Money and quantity conversion. The ONLY place floats meet integers.
 *
 * Everything stored and computed is an integer — cents for money, thousandths
 * for quantities. Floats exist at the two edges: what the model hands us, and
 * what the client renders. Converting in one place means a rounding decision is
 * made once and is the same decision everywhere.
 *
 * Why this matters more than it looks: the old flow had the model produce
 * `low`, `high`, a tax row and a grand total as floats, then summed them in
 * JavaScript. That is two sources of drift stacked — the model's arithmetic and
 * IEEE754 — on a number a contractor hands to a customer.
 */

/** Dollars (or a dollar string) to integer cents. Rounds half away from zero. */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "string" ? parseFloat(value.replace(/[$,\s]/g, "")) : value;
  if (!Number.isFinite(n)) return 0;
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatCents(cents: number): string {
  return fromCents(cents).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Quantities to thousandths — 10.5 cu yd becomes 10500. */
export function toMilli(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return 0;
  return Math.sign(n) * Math.round(Math.abs(n) * 1000);
}

export function fromMilli(milli: number): number {
  return Math.round(milli) / 1000;
}

/**
 * qty x unit price, both integers, result in cents.
 *
 * qtyMilli is thousandths and unitCents is cents, so the product is
 * cents-thousandths and has to come back down by 1000. Rounding here rather
 * than at the end is deliberate: a line total is a real number a contractor
 * reads off the row, so it should be a whole number of cents before anything
 * sums it.
 */
export function extendCents(qtyMilli: number, unitCents: number): number {
  return Math.round((qtyMilli * unitCents) / 1000);
}

/** Basis points applied to cents. 700 bps of 52800 cents = 3696 cents. */
export function applyBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10000);
}

export const bpsToPct = (bps: number): number => bps / 100;
export const pctToBps = (pct: number): number => Math.round(pct * 100);
