/**
 * Gate tests. Run with:  npx tsx --test lib/estimate/gates.test.ts
 *
 * The clean-estimate test is the most important one here. Gates that reject bad
 * output are easy; gates that don't also reject *good* output are the hard part,
 * and an over-strict gate stack costs you a repair call on every estimate.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  gateBounds,
  gateNoDuplicates,
  gateRequiredRows,
  gateSources,
  gateTaxMath,
  gateTotalMath,
  gateUnits,
  repairInstruction,
  verifyEstimate,
} from "./gates";
import { parseUnit, type Estimate, type LineItem } from "./schema";

const YARD = "Cedar Valley Supply – Hwy 1, Iowa City";
const BOX = "Menards – Iowa City, Hwy 1 W";

function li(
  material: string,
  qty: number,
  unit: string,
  low: number,
  high: number,
  source = YARD
): LineItem {
  return { material, qty, unit, low, high, source };
}

/** A mulch-bed job that should sail through every gate. */
function cleanEstimate(): Estimate {
  const materials = [
    li("Shredded hardwood mulch, bulk", 10, "cu yd", 34, 42),
    li("Screened topsoil, bulk", 4, "cu yd", 28, 34),
    li("Landscape fabric, 3ft x 100ft roll", 2, "roll", 32, 48, BOX),
    li("Fabric staples, pack of 75", 1, "pack", 12, 18, BOX),
  ];
  // subtotal: low 340+112+64+12 = 528 ; high 420+136+96+18 = 670
  const subLow = 528;
  const subHigh = 670;
  const delLow = 85;
  const delHigh = 145;
  const taxLow = Math.round(subLow * 0.07 * 100) / 100; // 36.96
  const taxHigh = Math.round(subHigh * 0.07 * 100) / 100; // 46.90

  const items = [
    ...materials,
    li("Delivery (estimated)", 1, "each", delLow, delHigh),
    li("Iowa Sales Tax (7%)", 1, "total", taxLow, taxHigh, "Iowa state sales tax"),
    li(
      "GRAND TOTAL",
      1,
      "total",
      subLow + delLow + taxLow,
      subHigh + delHigh + taxHigh,
      "—"
    ),
  ];

  return {
    line_items: items,
    total_low: subLow + delLow + taxLow,
    total_high: subHigh + delHigh + taxHigh,
    clarifications_needed: [],
    notes: "Mulch bed refresh with fabric.",
  };
}

// ── the important one ──────────────────────────────────────────────────────

test("a well-formed estimate passes every gate", () => {
  const v = verifyEstimate(cleanEstimate());
  assert.equal(
    v.errors.length,
    0,
    "unexpected errors: " + v.errors.map((e) => `${e.gate}: ${e.detail}`).join(" | ")
  );
  assert.equal(v.passed, true);
});

test("a clean estimate raises no warnings either", () => {
  const v = verifyEstimate(cleanEstimate());
  assert.equal(
    v.warnings.length,
    0,
    "unexpected warnings: " + v.warnings.map((w) => w.detail).join(" | ")
  );
});

// ── units ──────────────────────────────────────────────────────────────────

test("parseUnit refuses to guess an unknown unit", () => {
  assert.equal(parseUnit("pallet"), null);
  assert.equal(parseUnit("truckload"), null);
  assert.equal(parseUnit(""), null);
  assert.equal(parseUnit(undefined), null);
});

test("parseUnit normalizes the spellings a model actually emits", () => {
  assert.equal(parseUnit("cubic yards"), "cu yd");
  assert.equal(parseUnit("CU YD"), "cu yd");
  assert.equal(parseUnit("per ton"), "ton");
  assert.equal(parseUnit("sq. ft."), "sq ft");
  assert.equal(parseUnit("linear feet"), "linear ft");
  assert.equal(parseUnit("/each"), "each");
});

test("sod priced per pallet is caught", () => {
  const est = cleanEstimate();
  est.line_items.unshift(li("Bluegrass sod", 500, "pallet", 0.45, 0.6));
  const g = gateUnits(est).filter((r) => !r.passed);
  assert.ok(g.length > 0);
  assert.match(g[0].detail, /pallet/);
});

test("aggregate priced in cu yd is allowed but sod in cu yd is not", () => {
  const ok = cleanEstimate();
  ok.line_items.unshift(li("Crushed limestone road rock", 6, "cu yd", 30, 40));
  assert.equal(gateUnits(ok).filter((r) => !r.passed).length, 0);

  const bad = cleanEstimate();
  bad.line_items.unshift(li("Bluegrass sod", 5, "cu yd", 30, 40));
  assert.ok(gateUnits(bad).some((r) => !r.passed && /must be sq ft/.test(r.detail)));
});

// ── sources ────────────────────────────────────────────────────────────────

test("estimating sites are rejected as sources", () => {
  const est = cleanEstimate();
  est.line_items[0].source = "HomeAdvisor cost guide";
  const g = gateSources(est).filter((r) => !r.passed && r.severity === "error");
  assert.equal(g.length, 1);
  assert.match(g[0].detail, /HomeAdvisor/);
});

test("a bare chain name with no location warns", () => {
  const est = cleanEstimate();
  est.line_items[2].source = "Home Depot";
  const g = gateSources(est).filter((r) => !r.passed);
  assert.equal(g.length, 1);
  assert.equal(g[0].severity, "warn");
});

test("the tax row's source is not treated as a bare chain", () => {
  const v = verifyEstimate(cleanEstimate());
  assert.equal(v.gates.filter((g) => g.gate === "sources" && !g.passed).length, 0);
});

// ── duplicates ─────────────────────────────────────────────────────────────

test("the same material in bulk and bagged is caught", () => {
  const est = cleanEstimate();
  est.line_items.unshift(li("Shredded hardwood mulch, 2 cu ft bag", 30, "bag", 3.5, 4.5, BOX));
  const g = gateNoDuplicates(est).filter((r) => !r.passed && r.severity === "error");
  assert.equal(g.length, 1);
  assert.match(g[0].detail, /hardwood_mulch/);
});

test("the same material twice in one unit only warns", () => {
  const est = cleanEstimate();
  est.line_items.unshift(li("Brown dyed mulch", 5, "cu yd", 38, 46));
  est.line_items.unshift(li("Black dyed mulch", 5, "cu yd", 38, 46));
  const g = gateNoDuplicates(est).filter((r) => !r.passed);
  assert.equal(g.length, 1);
  assert.equal(g[0].severity, "warn");
});

// ── required rows ──────────────────────────────────────────────────────────

test("a missing delivery row is caught", () => {
  const est = cleanEstimate();
  est.line_items = est.line_items.filter((i) => !/delivery/i.test(i.material));
  assert.ok(gateRequiredRows(est).some((r) => !r.passed && /delivery/.test(r.detail)));
});

test("a missing tax row is caught", () => {
  const est = cleanEstimate();
  est.line_items = est.line_items.filter((i) => !/tax/i.test(i.material));
  assert.ok(gateRequiredRows(est).some((r) => !r.passed && /tax/.test(r.detail)));
});

// ── arithmetic ─────────────────────────────────────────────────────────────

test("a wrong tax amount is caught", () => {
  const est = cleanEstimate();
  const tax = est.line_items.find((i) => /tax/i.test(i.material))!;
  tax.low = 20;
  tax.high = 25;
  const g = gateTaxMath(est).filter((r) => !r.passed);
  assert.equal(g.length, 1);
  assert.match(g[0].detail, /7% of the/);
});

test("tax computed on the wrong base (including delivery) is caught", () => {
  const est = cleanEstimate();
  const tax = est.line_items.find((i) => /tax/i.test(i.material))!;
  // 7% of subtotal + delivery instead of subtotal alone
  tax.low = Math.round((528 + 85) * 0.07 * 100) / 100;
  tax.high = Math.round((670 + 145) * 0.07 * 100) / 100;
  assert.ok(gateTaxMath(est).some((r) => !r.passed));
});

test("a grand total that doesn't add up is caught", () => {
  const est = cleanEstimate();
  const gt = est.line_items.find((i) => /grand/i.test(i.material))!;
  gt.low = 500;
  gt.high = 700;
  assert.ok(gateTotalMath(est).some((r) => !r.passed && /grand total is/.test(r.detail)));
});

test("top-level totals disagreeing with the rows is caught", () => {
  const est = cleanEstimate();
  est.total_low = 100;
  est.total_high = 200;
  assert.ok(gateTotalMath(est).some((r) => !r.passed && /total_low/.test(r.detail)));
});

test("cent-level float drift is not treated as an error", () => {
  const est = cleanEstimate();
  const gt = est.line_items.find((i) => /grand/i.test(i.material))!;
  gt.low += 0.01;
  gt.high -= 0.01;
  est.total_low += 0.01;
  est.total_high -= 0.01;
  assert.equal(gateTotalMath(est).filter((r) => !r.passed).length, 0);
});

// ── bounds ─────────────────────────────────────────────────────────────────

test("a shifted decimal is caught by bounds", () => {
  const est = cleanEstimate();
  est.line_items.unshift(li("Washed river rock", 8, "ton", 61, 610));
  const g = gateBounds(est).filter((r) => !r.passed && r.severity === "error");
  assert.equal(g.length, 1);
  assert.match(g[0].detail, /river rock/i);
});

test("a slightly-over price only warns, since bands go stale", () => {
  const est = cleanEstimate();
  est.line_items.unshift(li("Shredded hardwood mulch, bulk", 5, "cu yd", 52, 62));
  const g = gateBounds(est).filter((r) => !r.passed);
  assert.equal(g.length, 1);
  assert.equal(g[0].severity, "warn");
});

test("an unknown material is not blocked by bounds", () => {
  const est = cleanEstimate();
  est.line_items.unshift(li("Custom powder-coated bollard sleeve", 3, "each", 240, 310));
  assert.equal(gateBounds(est).filter((r) => !r.passed).length, 0);
});

test("sod priced like a pallet is caught", () => {
  const est = cleanEstimate();
  est.line_items.unshift(li("Bluegrass sod", 500, "sq ft", 4.2, 4.8));
  assert.ok(gateBounds(est).some((r) => !r.passed && r.severity === "error"));
});

// ── structure ──────────────────────────────────────────────────────────────

test("low above high is caught", () => {
  const est = cleanEstimate();
  est.line_items[0].low = 90;
  est.line_items[0].high = 40;
  const v = verifyEstimate(est);
  assert.ok(v.errors.some((e) => e.gate === "structure"));
});

test("an empty estimate fails structurally and is repairable", () => {
  const v = verifyEstimate({
    line_items: [],
    total_low: 0,
    total_high: 0,
    clarifications_needed: [],
    notes: "",
  });
  assert.equal(v.passed, false);
  assert.equal(v.repairable, true);
});

// ── repair instruction ─────────────────────────────────────────────────────

test("the repair instruction names the gate, the numbers and the row", () => {
  const est = cleanEstimate();
  const gt = est.line_items.find((i) => /grand/i.test(i.material))!;
  gt.low = 500;
  gt.high = 700;
  const v = verifyEstimate(est);
  const msg = repairInstruction(v.errors, est);

  assert.match(msg, /total_math/);
  assert.match(msg, /GRAND TOTAL/);
  assert.match(msg, /\$500\.00/);
  assert.match(msg, /do not re-research prices/i);
});

test("verdict is repairable when every hard failure is fixable by re-prompting", () => {
  const est = cleanEstimate();
  const tax = est.line_items.find((i) => /tax/i.test(i.material))!;
  tax.low = 1;
  tax.high = 2;
  const v = verifyEstimate(est);
  assert.equal(v.passed, false);
  assert.equal(v.repairable, true);
});
