/**
 * Deterministic gates.
 *
 * This file is the PRE-OUTPUT CHECKLIST from the old system prompt, moved out
 * of the model's head and into code. The model was being asked to verify its
 * own output inside the same context that produced it, which is the one thing
 * models are reliably bad at. Every item on that checklist is mechanically
 * decidable, so it is decided here instead — outside the model, on the parsed
 * JSON, where arithmetic is arithmetic.
 *
 * Each gate declares whether its failure is `repairable`. That flag is what
 * drives recovery: repairable failures get one targeted re-prompt naming the
 * specific violation; terminal ones are surfaced to the contractor rather than
 * silently passed through.
 */

import {
  type Estimate,
  type GateResult,
  type LineItem,
  IOWA_TAX_RATE,
  cents,
  extend,
  fail,
  isDelivery,
  isGrandTotal,
  isSpecial,
  isTax,
  parseUnit,
  pass,
  subtotal,
} from "./schema";
import { DELIVERY_BAND, checkBand, matchPrior, requiredUnit } from "./priors";

/** Sources RULE 3 forbids. Estimating sites are not suppliers. */
const BANNED_SOURCES = [
  "sodcalculator",
  "homeadvisor",
  "angi",
  "angieslist",
  "thumbtack",
  "homeyou",
  "fixr",
  "homewyse",
  "costhelper",
  "improvenet",
  "porch.com",
  "houzz",
];

/** A source naming only a chain with no location fails RULE 3's specificity. */
const BARE_CHAINS = /^(home\s*depot|lowe'?s|menards|walmart|ace\s*hardware|tractor\s*supply)\.?$/i;

// ── 1. structure ───────────────────────────────────────────────────────────

export function gateStructure(est: Estimate): GateResult[] {
  const out: GateResult[] = [];

  if (!Array.isArray(est.line_items) || est.line_items.length === 0) {
    return [fail("structure", "estimate has no line items", { repairable: true })];
  }

  const bad: number[] = [];
  est.line_items.forEach((i, idx) => {
    const numeric =
      Number.isFinite(i.qty) && Number.isFinite(i.low) && Number.isFinite(i.high);
    if (!numeric || !i.material || typeof i.material !== "string") bad.push(idx);
  });
  if (bad.length) {
    out.push(
      fail("structure", `${bad.length} line(s) missing a material name or numeric price`, {
        repairable: true,
        lines: bad,
      })
    );
  }

  const inverted = est.line_items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => Number.isFinite(i.low) && Number.isFinite(i.high) && i.low > i.high)
    .map(({ idx }) => idx);
  if (inverted.length) {
    out.push(
      fail("structure", `${inverted.length} line(s) have low above high`, {
        repairable: true,
        lines: inverted,
      })
    );
  }

  const nonPositive = est.line_items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => !isGrandTotal(i) && Number.isFinite(i.qty) && i.qty <= 0)
    .map(({ idx }) => idx);
  if (nonPositive.length) {
    out.push(
      fail("structure", `${nonPositive.length} line(s) have a non-positive quantity`, {
        repairable: true,
        lines: nonPositive,
      })
    );
  }

  return out.length ? out : [pass("structure", `${est.line_items.length} well-formed lines`)];
}

// ── 2. no bulk + bagged duplicates (RULE 1) ────────────────────────────────

export function gateNoDuplicates(est: Estimate): GateResult[] {
  const rows = est.line_items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => !isSpecial(i));

  const byPrior = new Map<string, { idx: number; unit: string }[]>();
  for (const { i, idx } of rows) {
    const p = matchPrior(i.material);
    if (!p) continue;
    const list = byPrior.get(p.key) ?? [];
    list.push({ idx, unit: i.unit });
    byPrior.set(p.key, list);
  }

  const out: GateResult[] = [];
  for (const [key, entries] of byPrior) {
    if (entries.length < 2) continue;
    const units = new Set(entries.map((e) => parseUnit(e.unit) ?? e.unit));
    // Same material in two different units is the bulk-and-bagged duplication
    // RULE 1 forbids. Same material twice in the SAME unit is usually a
    // legitimate split (two mulch colors, two bed areas), so only warn.
    const lines = entries.map((e) => e.idx);
    if (units.size > 1) {
      out.push(
        fail(
          "no_duplicates",
          `"${key}" appears ${entries.length}x in different units (${[...units].join(", ")}) — pick bulk or bagged, not both`,
          { repairable: true, lines }
        )
      );
    } else {
      out.push(
        fail("no_duplicates", `"${key}" appears ${entries.length}x in the same unit — verify this is intentional`, {
          repairable: false,
          severity: "warn",
          lines,
        })
      );
    }
  }

  return out.length ? out : [pass("no_duplicates", "no bulk/bagged duplication")];
}

// ── 3. units (RULE 2) ──────────────────────────────────────────────────────

export function gateUnits(est: Estimate): GateResult[] {
  const out: GateResult[] = [];
  const unknown: number[] = [];
  const wrong: string[] = [];
  const wrongLines: number[] = [];

  est.line_items.forEach((item, idx) => {
    if (isGrandTotal(item)) return; // "total" row, checked by the totals gate

    const u = parseUnit(item.unit);
    if (u === null) {
      unknown.push(idx);
      return;
    }
    if (isSpecial(item)) return;

    const prior = matchPrior(item.material);
    if (!prior) return; // no prior, no opinion on its unit

    const required = requiredUnit(prior.cls);
    if (required && u !== required) {
      wrong.push(`"${item.material}" is ${u}, must be ${required}`);
      wrongLines.push(idx);
      return;
    }
    if (!prior.units.includes(u)) {
      wrong.push(`"${item.material}" is ${u}, expected one of ${prior.units.join(" / ")}`);
      wrongLines.push(idx);
    }
  });

  if (unknown.length) {
    const names = unknown.map((i) => `"${est.line_items[i].unit}"`).join(", ");
    out.push(
      fail("units", `${unknown.length} line(s) use a unit outside the allowed table: ${names}`, {
        repairable: true,
        lines: unknown,
      })
    );
  }
  if (wrong.length) {
    out.push(
      fail("units", wrong.join("; "), { repairable: true, lines: wrongLines })
    );
  }

  return out.length ? out : [pass("units", "all units conform to the required table")];
}

// ── 4. sources (RULE 3) ────────────────────────────────────────────────────

export function gateSources(est: Estimate): GateResult[] {
  const out: GateResult[] = [];
  const banned: number[] = [];
  const bare: number[] = [];
  const missing: number[] = [];

  est.line_items.forEach((item, idx) => {
    if (isGrandTotal(item)) return;
    const src = (item.source || "").trim();
    if (!src) {
      missing.push(idx);
      return;
    }
    const lower = src.toLowerCase();
    if (BANNED_SOURCES.some((b) => lower.includes(b))) {
      banned.push(idx);
      return;
    }
    if (isTax(item)) return; // "Iowa state sales tax" is a legitimate source
    if (BARE_CHAINS.test(src)) bare.push(idx);
  });

  if (banned.length) {
    const names = banned.map((i) => `"${est.line_items[i].source}"`).join(", ");
    out.push(
      fail("sources", `${banned.length} line(s) cite an estimating site rather than a seller: ${names}`, {
        repairable: true,
        lines: banned,
      })
    );
  }
  if (missing.length) {
    out.push(
      fail("sources", `${missing.length} line(s) have no source`, {
        repairable: true,
        lines: missing,
      })
    );
  }
  if (bare.length) {
    const names = bare.map((i) => `"${est.line_items[i].source}"`).join(", ");
    out.push(
      fail("sources", `${bare.length} line(s) name a chain with no location: ${names}`, {
        repairable: true,
        severity: "warn",
        lines: bare,
      })
    );
  }

  return out.length ? out : [pass("sources", "all sources are named sellers")];
}

// ── 5. required bottom-line rows (RULE 4) ──────────────────────────────────

export function gateRequiredRows(est: Estimate): GateResult[] {
  const out: GateResult[] = [];
  const has = (fn: (i: LineItem) => boolean) => est.line_items.some(fn);

  if (!has(isDelivery)) {
    out.push(fail("required_rows", "no delivery line item", { repairable: true }));
  }
  if (!has(isTax)) {
    out.push(fail("required_rows", "no Iowa sales tax line item", { repairable: true }));
  }
  if (!has(isGrandTotal)) {
    out.push(fail("required_rows", "no grand total line item", { repairable: true }));
  }

  return out.length ? out : [pass("required_rows", "delivery, tax and grand total all present")];
}

// ── 6. arithmetic ──────────────────────────────────────────────────────────

/** Cent-level tolerance scaled to magnitude — float drift is not an error. */
const tol = (n: number) => Math.max(1.0, Math.abs(n) * 0.01);

export function gateTaxMath(est: Estimate): GateResult[] {
  const taxRow = est.line_items.find(isTax);
  if (!taxRow) return [pass("tax_math", "no tax row to check")];

  const sub = subtotal(est.line_items);
  const expectLow = cents(sub.low * IOWA_TAX_RATE);
  const expectHigh = cents(sub.high * IOWA_TAX_RATE);
  const actual = extend(taxRow);

  const dLow = Math.abs(actual.low - expectLow);
  const dHigh = Math.abs(actual.high - expectHigh);

  if (dLow > tol(expectLow) || dHigh > tol(expectHigh)) {
    return [
      fail(
        "tax_math",
        `tax is $${actual.low.toFixed(2)}–$${actual.high.toFixed(2)}, ` +
          `but 7% of the $${sub.low.toFixed(2)}–$${sub.high.toFixed(2)} material subtotal is ` +
          `$${expectLow.toFixed(2)}–$${expectHigh.toFixed(2)}`,
        { repairable: true, lines: [est.line_items.indexOf(taxRow)] }
      ),
    ];
  }
  return [pass("tax_math", `7% of subtotal checks out`)];
}

export function gateTotalMath(est: Estimate): GateResult[] {
  const out: GateResult[] = [];
  const sub = subtotal(est.line_items);
  const delivery = est.line_items.filter(isDelivery).reduce(
    (a, i) => {
      const e = extend(i);
      return { low: a.low + e.low, high: a.high + e.high };
    },
    { low: 0, high: 0 }
  );
  const tax = est.line_items.filter(isTax).reduce(
    (a, i) => {
      const e = extend(i);
      return { low: a.low + e.low, high: a.high + e.high };
    },
    { low: 0, high: 0 }
  );

  const expectLow = cents(sub.low + delivery.low + tax.low);
  const expectHigh = cents(sub.high + delivery.high + tax.high);

  const gt = est.line_items.find(isGrandTotal);
  if (gt) {
    const actual = extend(gt);
    if (
      Math.abs(actual.low - expectLow) > tol(expectLow) ||
      Math.abs(actual.high - expectHigh) > tol(expectHigh)
    ) {
      out.push(
        fail(
          "total_math",
          `grand total is $${actual.low.toFixed(2)}–$${actual.high.toFixed(2)}, ` +
            `but materials + delivery + tax is $${expectLow.toFixed(2)}–$${expectHigh.toFixed(2)}`,
          { repairable: true, lines: [est.line_items.indexOf(gt)] }
        )
      );
    }
  }

  // total_low / total_high at the top level must match the grand total row.
  if (Number.isFinite(est.total_low) && Number.isFinite(est.total_high)) {
    if (
      Math.abs(est.total_low - expectLow) > tol(expectLow) ||
      Math.abs(est.total_high - expectHigh) > tol(expectHigh)
    ) {
      out.push(
        fail(
          "total_math",
          `total_low/total_high ($${est.total_low.toFixed(2)}–$${est.total_high.toFixed(2)}) ` +
            `disagree with the computed total ($${expectLow.toFixed(2)}–$${expectHigh.toFixed(2)})`,
          { repairable: true }
        )
      );
    }
  }

  return out.length ? out : [pass("total_math", "totals reconcile")];
}

// ── 7. price bounds ────────────────────────────────────────────────────────

export function gateBounds(est: Estimate): GateResult[] {
  const out: GateResult[] = [];
  const hard: string[] = [];
  const hardLines: number[] = [];
  const soft: string[] = [];
  const softLines: number[] = [];
  let checked = 0;

  est.line_items.forEach((item, idx) => {
    if (isGrandTotal(item) || isTax(item)) return;

    if (isDelivery(item)) {
      const [lo, hi] = DELIVERY_BAND;
      const e = extend(item);
      if (e.high > 0 && (e.low < lo * 0.4 || e.high > hi * 2)) {
        soft.push(`delivery $${e.low.toFixed(2)}–$${e.high.toFixed(2)} is unusual (typical $${lo}–$${hi})`);
        softLines.push(idx);
      }
      return;
    }

    const prior = matchPrior(item.material);
    const u = parseUnit(item.unit);
    if (!prior || !u) return; // unmatched material or unreadable unit: no opinion

    // Check the high side; a low that's under band is often a legitimate
    // volume price, while a high over band is where decimal errors show up.
    const c = checkBand(prior, u, item.high);
    if (c.ok) {
      checked++;
      return;
    }
    checked++;
    const [lo, hi] = c.band!;
    const msg =
      `"${item.material}" at $${item.high.toFixed(2)}/${u} ` +
      `(expected $${lo}–$${hi}/${u} for ${prior.label.toLowerCase()})`;

    if (c.distance > 1.0) {
      hard.push(msg);
      hardLines.push(idx);
    } else {
      soft.push(msg);
      softLines.push(idx);
    }
  });

  if (hard.length) {
    out.push(
      fail("bounds", `${hard.length} price(s) far outside the expected range: ${hard.join("; ")}`, {
        repairable: true,
        lines: hardLines,
      })
    );
  }
  if (soft.length) {
    out.push(
      fail("bounds", soft.join("; "), { repairable: false, severity: "warn", lines: softLines })
    );
  }

  return out.length ? out : [pass("bounds", `${checked} priced line(s) within expected ranges`)];
}

// ── runner ─────────────────────────────────────────────────────────────────

export interface Verdict {
  gates: GateResult[];
  errors: GateResult[];
  warnings: GateResult[];
  passed: boolean;
  /** True when every hard failure is something a targeted re-prompt could fix. */
  repairable: boolean;
}

export function verifyEstimate(est: Estimate): Verdict {
  const gates = [
    ...gateStructure(est),
    ...gateNoDuplicates(est),
    ...gateUnits(est),
    ...gateSources(est),
    ...gateRequiredRows(est),
    ...gateTaxMath(est),
    ...gateTotalMath(est),
    ...gateBounds(est),
  ];

  const errors = gates.filter((g) => !g.passed && g.severity === "error");
  const warnings = gates.filter((g) => !g.passed && g.severity === "warn");

  return {
    gates,
    errors,
    warnings,
    passed: errors.length === 0,
    repairable: errors.length > 0 && errors.every((g) => g.repairable),
  };
}

/**
 * Turns failures into a repair instruction.
 *
 * The point of this is specificity. The old prompt asked the model to re-check
 * a generic eight-item list, which gives it nothing it didn't already have.
 * This hands it the exact violated constraint and the exact numbers, which is
 * a different and much easier task.
 */
export function repairInstruction(errors: GateResult[], est: Estimate): string {
  const lines = errors.map((e) => {
    const where =
      e.lines && e.lines.length
        ? ` (line ${e.lines.map((i) => i + 1).join(", ")}: ${e.lines
            .map((i) => `"${est.line_items[i]?.material ?? "?"}"`)
            .join(", ")})`
        : "";
    return `- [${e.gate}] ${e.detail}${where}`;
  });

  return `Your previous estimate failed automated validation. These are the specific problems found:

${lines.join("\n")}

Return the COMPLETE corrected estimate as JSON in the same format. Fix only what is listed above — do not re-research prices, do not add or remove unrelated line items, and keep every source that was not flagged. Recompute the tax and grand total from the corrected material rows.`;
}
