/**
 * The estimate contract, plus the unit vocabulary from RULE 2 of the system
 * prompt.
 *
 * These types mirror what app/page.tsx already expects, so nothing on the
 * client has to change. What is new is that the shape is now *checked* on the
 * way out of the API instead of being assumed.
 */

// ── Units ──────────────────────────────────────────────────────────────────

/** Exactly the units RULE 2 permits. Anything else is a gate failure. */
export const UNITS = [
  "sq ft",
  "cu yd",
  "ton",
  "bag",
  "each",
  "linear ft",
  "roll",
  "pack",
  "bottle",
  "total",
] as const;

export type Unit = (typeof UNITS)[number];

/**
 * Supplier and model spellings mapped onto the canonical unit.
 *
 * Returns null rather than guessing. A guessed unit produces a plausible wrong
 * line on a quote a contractor hands to a customer, which is the failure mode
 * that survives review — much worse than a visible "I couldn't read this".
 */
export function parseUnit(raw: string | null | undefined): Unit | null {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase().replace(/[._]/g, " ");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/^(per|each of|by the)\s+/, "").replace(/^\//, "").trim();
  s = s.replace(/s$/, ""); // crude singularize; re-checked against the table below

  const table: Record<string, Unit> = {
    "sq ft": "sq ft", sqft: "sq ft", sf: "sq ft", "square foot": "sq ft",
    "square feet": "sq ft", "square ft": "sq ft",

    "cu yd": "cu yd", cuyd: "cu yd", yd3: "cu yd", yd: "cu yd", yard: "cu yd",
    "cubic yard": "cu yd", "cubic feet": "cu yd", cy: "cu yd",
    "cubic yd": "cu yd",

    ton: "ton", tn: "ton",

    bag: "bag",
    each: "each", ea: "each", unit: "each", piece: "each", pc: "each",

    "linear ft": "linear ft", "lin ft": "linear ft", lnft: "linear ft",
    lf: "linear ft", "linear foot": "linear ft", "linear feet": "linear ft",

    roll: "roll",
    pack: "pack", pk: "pack",
    bottle: "bottle", btl: "bottle", jug: "bottle",

    total: "total",
  };

  return table[s] ?? null;
}

// ── Estimate shape ─────────────────────────────────────────────────────────

export interface LineItem {
  material: string;
  qty: number;
  unit: string;
  low: number;
  high: number;
  source: string;
}

export interface Estimate {
  line_items: LineItem[];
  total_low: number;
  total_high: number;
  clarifications_needed: string[];
  notes: string;
}

/** Attached by the API so the client can show what was checked. */
export interface VerifiedEstimate extends Estimate {
  verification?: {
    passed: boolean;
    repaired: boolean;
    gates: GateResult[];
    warnings: GateResult[];
  };
}

// ── Gate results ───────────────────────────────────────────────────────────

export type Severity = "error" | "warn";

export interface GateResult {
  gate: string;
  passed: boolean;
  detail: string;
  /** Can a targeted re-prompt plausibly fix this? Drives the repair path. */
  repairable: boolean;
  severity: Severity;
  /** Indices into line_items this finding refers to, for UI highlighting. */
  lines?: number[];
}

export function fail(
  gate: string,
  detail: string,
  opts: { repairable?: boolean; severity?: Severity; lines?: number[] } = {}
): GateResult {
  return {
    gate,
    passed: false,
    detail,
    repairable: opts.repairable ?? true,
    severity: opts.severity ?? "error",
    lines: opts.lines,
  };
}

export function pass(gate: string, detail = ""): GateResult {
  return { gate, passed: true, detail, repairable: false, severity: "error" };
}

// ── Row classification ─────────────────────────────────────────────────────
// Kept identical to the predicates in app/page.tsx so the server and the client
// never disagree about which rows are bottom-line rows rather than materials.

export const isDelivery = (i: LineItem) => /delivery/i.test(i.material);
export const isTax = (i: LineItem) => /sales.?tax|iowa.*tax/i.test(i.material);
export const isGrandTotal = (i: LineItem) => /grand.?total/i.test(i.material);
export const isSpecial = (i: LineItem) =>
  isDelivery(i) || isTax(i) || isGrandTotal(i);

/** Just the material rows — everything the subtotal is computed from. */
export const materialRows = (items: LineItem[]) => items.filter((i) => !isSpecial(i));

export const IOWA_TAX_RATE = 0.07;

/** Round to cents. Float drift is not a gate failure. */
export const cents = (n: number) => Math.round(n * 100) / 100;

export const extend = (i: LineItem) => ({
  low: cents(i.qty * i.low),
  high: cents(i.qty * i.high),
});

export function subtotal(items: LineItem[]): { low: number; high: number } {
  return materialRows(items).reduce(
    (acc, i) => {
      const e = extend(i);
      return { low: cents(acc.low + e.low), high: cents(acc.high + e.high) };
    },
    { low: 0, high: 0 }
  );
}
