/**
 * Receipt matching and correction-diff tests.
 *   npx tsx --test lib/catalog/scan.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { Material } from "../db/schema";
import { diffLines } from "../estimates/service";
import type { LineItem } from "../estimate/schema";
import { normalizeScan, propose, similarity } from "./scan";

const now = new Date();
const mat = (id: string, name: string, unit: string, cents: number, supplierId: string | null = null) =>
  ({ id, name, unit, unitCostCents: cents, supplierId, ownerId: "u", category: "aggregate", priceUpdatedAt: now } as Material);

const CATALOG = [
  mat("m1", "Clean stone, 1 in", "ton", 3300, "sA"),
  mat("m2", "Crushed limestone / road rock", "ton", 2300, "sA"),
  mat("m3", "Shredded hardwood mulch (bulk)", "cu yd", 3800),
  mat("m4", "Landscape fabric (3 ft x 100 ft roll)", "roll", 3800),
];

test("normalize fills a missing unit price from total / qty and drops junk", () => {
  const s = normalizeScan({
    supplier: { name: "Conklin Quarry" },
    date: "2026-09-20",
    lines: [
      { description: "1\" CLEAN STONE", qty: "14.62", unit: "TN", lineTotal: "$496.35" },
      { description: "", qty: 1, unitPrice: 5 },
      { description: "ROAD STONE", qty: 10, unit: "ton", unitPrice: "24.10" },
    ],
  });
  assert.equal(s.lines.length, 2);
  assert.equal(s.lines[0].unit, "ton");
  assert.equal(s.lines[0].unitPrice, 33.95);
  assert.equal(s.date, "2026-09-20");
});

test("similarity ignores filler words and punctuation", () => {
  assert.ok(similarity("1 in CLEAN STONE", "Clean stone, 1 in") >= 0.99);
  assert.ok(similarity("hardwood mulch", "Shredded hardwood mulch (bulk)") >= 0.99);
  assert.ok(similarity("peony", "Clean stone, 1 in") === 0);
});

test("proposals match by name AND unit, and flag big price jumps", () => {
  const scan = normalizeScan({
    supplier: { name: "Conklin" },
    lines: [
      { description: "1 in clean stone", qty: 14, unit: "ton", unitPrice: 34.5 },
      { description: "hardwood mulch", qty: 20, unit: "ton", unitPrice: 20 }, // wrong unit for m3
      { description: "road rock", qty: 5, unit: "ton", unitPrice: 60 }, // +160%
      { description: "mystery", qty: 1, unit: "each" }, // no price
    ],
  });
  const p = propose(scan, CATALOG, "sA");
  assert.equal(p[0].action, "update");
  assert.equal(p[0].match?.materialId, "m1");
  assert.equal(p[1].action, "new");
  assert.match(p[1].flag, /priced per cu yd/);
  assert.equal(p[2].match?.materialId, "m2");
  assert.match(p[2].flag, /Price up 161%/);
  assert.equal(p[3].action, "skip");
});

// ── the correction log ─────────────────────────────────────────────────────

const li = (over: Partial<LineItem> & { material: string }): LineItem => ({
  qty: 1, unit: "ton", low: 10, high: 10, source: "", kind: "material", ...over,
});

test("edits are logged per field; reordering alone logs nothing", () => {
  const orig = [li({ material: "A", materialId: "a", qty: 5 }), li({ material: "B", materialId: "b" })];
  assert.deepEqual(diffLines(orig, [orig[1], orig[0]]), []);

  const edited = [li({ material: "A", materialId: "a", qty: 7 }), li({ material: "B", materialId: "b", low: 12, high: 12 })];
  const d = diffLines(orig, edited);
  assert.deepEqual(
    d.map((x) => `${x.material}:${x.field}:${x.before}->${x.after}`),
    ["A:qty:5->7", "B:low:10->12", "B:high:10->12"]
  );
});

test("removed, added and swapped-in substitutes are all visible", () => {
  const orig = [li({ material: "#57 stone", materialId: "far" }), li({ material: "Fabric", materialId: "f", unit: "roll" })];
  const edited = [
    li({ material: "3/4 clean limestone", materialId: "near", replaced: "#57 stone" }),
    li({ material: "Emitter", unit: "each" }),
  ];
  const d = diffLines(orig, edited).map((x) => `${x.material}:${x.field}`);
  assert.ok(d.includes("#57 stone:material"));
  assert.ok(d.includes("Fabric:removed"));
  assert.ok(d.includes("Emitter:added"));
});

test("bottom-line rows are never treated as edits", () => {
  const orig = [li({ material: "A", materialId: "a" }), li({ material: "GRAND TOTAL", kind: "total", unit: "total", low: 100, high: 100 })];
  const edited = [li({ material: "A", materialId: "a" }), li({ material: "GRAND TOTAL", kind: "total", unit: "total", low: 150, high: 150 })];
  assert.deepEqual(diffLines(orig, edited), []);
});
