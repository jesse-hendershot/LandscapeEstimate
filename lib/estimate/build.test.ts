/**
 * Build and money tests.  npx tsx --test lib/estimate/build.test.ts
 *
 * The arithmetic here ends up on a quote a contractor hands a customer, so
 * these test exactness rather than approximate equality. If a test here uses a
 * tolerance, the design is wrong.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { buildEstimate, toLineItems, type ModelOutput } from "./build";
import { applyBps, extendCents, fromCents, toCents, toMilli } from "../money";
import { verifyBuild } from "./verifyBuild";
import type { Material } from "../db/schema";

function mat(over: Partial<Material> & { id: string; name: string }): Material {
  return {
    ownerId: "user_1",
    category: "mulch",
    unit: "cu yd",
    unitCostCents: 3800,
    supplier: "Cedar Valley Supply",
    supplierLocation: "Iowa City, IA",
    sku: null,
    coverage: "",
    notes: "",
    isActive: true,
    useCount: 0,
    priceUpdatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Material;
}

const CATALOG: Material[] = [
  mat({ id: "11111111-1111-1111-1111-111111111111", name: "Shredded hardwood mulch (bulk)", unitCostCents: 3800 }),
  mat({
    id: "22222222-2222-2222-2222-222222222222",
    name: "Screened topsoil (bulk)",
    unitCostCents: 3000,
  }),
  mat({
    id: "33333333-3333-3333-3333-333333333333",
    name: "Fabric / sod staples (pack of 75)",
    category: "hardware",
    unit: "pack",
    unitCostCents: 1500,
  }),
];

const TAX = 700; // 7%

// ── money primitives ───────────────────────────────────────────────────────

test("toCents rounds half away from zero and strips formatting", () => {
  assert.equal(toCents(38), 3800);
  assert.equal(toCents(38.005), 3801);
  assert.equal(toCents("$1,234.56"), 123456);
  assert.equal(toCents(""), 0);
  assert.equal(toCents(undefined), 0);
});

test("extendCents does not drift the way float multiplication does", () => {
  // 10.1 yd at $38.00 — the float version of this is 383.79999999999995
  const cents = extendCents(toMilli(10.1), 3800);
  assert.equal(cents, 38380);
  assert.equal(fromCents(cents), 383.8);
});

test("applyBps computes tax exactly", () => {
  assert.equal(applyBps(52800, 700), 3696);
  assert.equal(applyBps(67000, 700), 4690);
});

// ── catalog pricing ────────────────────────────────────────────────────────

test("a catalog line is priced from the catalog, not from the model", () => {
  const out: ModelOutput = {
    catalog_lines: [{ catalogId: CATALOG[0].id, qty: 10 }],
  };
  const b = buildEstimate(out, CATALOG, { taxRateBps: TAX });

  assert.equal(b.lines.length, 1);
  assert.equal(b.lines[0].unitLowCents, 3800);
  assert.equal(b.lines[0].unitHighCents, 3800);
  assert.equal(b.lines[0].fromCatalog, true);
  assert.equal(b.subtotalLowCents, 38000);
});

test("catalog lines have no price range, because the price is known", () => {
  const b = buildEstimate(
    { catalog_lines: [{ catalogId: CATALOG[1].id, qty: 4 }] },
    CATALOG,
    { taxRateBps: TAX }
  );
  assert.equal(b.lines[0].unitLowCents, b.lines[0].unitHighCents);
});

test("the catalog supplier travels onto the line", () => {
  const b = buildEstimate(
    { catalog_lines: [{ catalogId: CATALOG[0].id, qty: 1 }] },
    CATALOG,
    { taxRateBps: TAX }
  );
  assert.match(b.lines[0].source, /Cedar Valley Supply/);
  assert.match(b.lines[0].source, /Iowa City/);
});

test("a hallucinated catalog id is dropped and reported, never guessed", () => {
  const b = buildEstimate(
    {
      catalog_lines: [
        { catalogId: "99999999-9999-9999-9999-999999999999", qty: 5 },
        { catalogId: CATALOG[0].id, qty: 2 },
      ],
    },
    CATALOG,
    { taxRateBps: TAX }
  );

  assert.equal(b.lines.length, 1);
  assert.deepEqual(b.droppedCatalogIds, ["99999999-9999-9999-9999-999999999999"]);
  assert.ok(verifyBuild(b).errors.some((e) => e.gate === "catalog_ids"));
});

test("a zero or negative quantity is dropped", () => {
  const b = buildEstimate(
    {
      catalog_lines: [
        { catalogId: CATALOG[0].id, qty: 0 },
        { catalogId: CATALOG[1].id, qty: -3 },
      ],
    },
    CATALOG,
    { taxRateBps: TAX }
  );
  assert.equal(b.lines.length, 0);
});

// ── custom lines ───────────────────────────────────────────────────────────

test("custom lines keep their researched range", () => {
  const b = buildEstimate(
    {
      custom_lines: [
        {
          name: "Serviceberry, 6ft B&B",
          unit: "each",
          qty: 3,
          low: 180,
          high: 240,
          source: "Iowa City Landscaping – Mormon Trek",
        },
      ],
    },
    CATALOG,
    { taxRateBps: TAX }
  );
  assert.equal(b.lines[0].unitLowCents, 18000);
  assert.equal(b.lines[0].unitHighCents, 24000);
  assert.equal(b.lines[0].fromCatalog, false);
});

test("an inverted low/high range is corrected rather than rejected", () => {
  const b = buildEstimate(
    {
      custom_lines: [
        { name: "Thing", unit: "each", qty: 1, low: 90, high: 40, source: "A Yard – Town" },
      ],
    },
    CATALOG,
    { taxRateBps: TAX }
  );
  assert.equal(b.lines[0].unitLowCents, 4000);
  assert.equal(b.lines[0].unitHighCents, 9000);
});

// ── computed bottom line ───────────────────────────────────────────────────

test("tax applies to materials and not to delivery", () => {
  const b = buildEstimate(
    {
      catalog_lines: [{ catalogId: CATALOG[0].id, qty: 10 }], // 380.00
      delivery: { low: 85, high: 85 },
    },
    CATALOG,
    { taxRateBps: TAX }
  );

  assert.equal(b.subtotalLowCents, 38000);
  assert.equal(b.deliveryLowCents, 8500);
  assert.equal(b.taxLowCents, 2660); // 7% of 380.00, not of 465.00
  assert.equal(b.totalLowCents, 38000 + 8500 + 2660);
});

test("the grand total is exactly materials + delivery + tax", () => {
  const b = buildEstimate(
    {
      catalog_lines: [
        { catalogId: CATALOG[0].id, qty: 10.5 },
        { catalogId: CATALOG[1].id, qty: 4 },
        { catalogId: CATALOG[2].id, qty: 2 },
      ],
      custom_lines: [
        { name: "Hydrangea, 3 gal", unit: "each", qty: 6, low: 38, high: 52, source: "Nursery – Town" },
      ],
      delivery: { low: 95, high: 145 },
    },
    CATALOG,
    { taxRateBps: TAX }
  );

  assert.equal(
    b.totalLowCents,
    b.subtotalLowCents + b.deliveryLowCents + b.taxLowCents
  );
  assert.equal(
    b.totalHighCents,
    b.subtotalHighCents + b.deliveryHighCents + b.taxHighCents
  );
});

test("markup lifts materials but never delivery or tax", () => {
  const plain = buildEstimate(
    { catalog_lines: [{ catalogId: CATALOG[0].id, qty: 10 }], delivery: { low: 100, high: 100 } },
    CATALOG,
    { taxRateBps: TAX }
  );
  const marked = buildEstimate(
    { catalog_lines: [{ catalogId: CATALOG[0].id, qty: 10 }], delivery: { low: 100, high: 100 } },
    CATALOG,
    { taxRateBps: TAX, markupBps: 2000 } // 20%
  );

  assert.equal(marked.subtotalLowCents, 45600); // 380.00 + 20%
  assert.equal(marked.deliveryLowCents, plain.deliveryLowCents);
  assert.equal(marked.taxLowCents, applyBps(45600, TAX)); // tax follows the marked-up base
});

test("a tax rate other than Iowa's is honored", () => {
  const b = buildEstimate(
    { catalog_lines: [{ catalogId: CATALOG[0].id, qty: 10 }] },
    CATALOG,
    { taxRateBps: 625 }
  );
  assert.equal(b.taxLowCents, applyBps(38000, 625));
});

// ── rendering ──────────────────────────────────────────────────────────────

test("toLineItems appends exactly the three bottom-line rows", () => {
  const b = buildEstimate(
    { catalog_lines: [{ catalogId: CATALOG[0].id, qty: 10 }], delivery: { low: 85, high: 145 } },
    CATALOG,
    { taxRateBps: TAX }
  );
  const items = toLineItems(b, TAX);

  assert.equal(items.length, 4); // 1 material + delivery + tax + grand total
  assert.match(items[1].material, /^Delivery/);
  assert.match(items[2].material, /Sales Tax \(7%\)/);
  assert.equal(items[3].material, "GRAND TOTAL");
});

test("delivery row is omitted when there is no delivery", () => {
  const b = buildEstimate(
    { catalog_lines: [{ catalogId: CATALOG[0].id, qty: 1 }], delivery: { low: 0, high: 0 } },
    CATALOG,
    { taxRateBps: TAX }
  );
  const items = toLineItems(b, TAX);
  assert.ok(!items.some((i) => /^Delivery/.test(i.material)));
});

test("rendered totals match the computed cents exactly", () => {
  const b = buildEstimate(
    {
      catalog_lines: [{ catalogId: CATALOG[0].id, qty: 10.1 }],
      delivery: { low: 85, high: 145 },
    },
    CATALOG,
    { taxRateBps: TAX }
  );
  const items = toLineItems(b, TAX);
  const grand = items.find((i) => i.material === "GRAND TOTAL")!;
  assert.equal(grand.low, fromCents(b.totalLowCents));
  assert.equal(grand.high, fromCents(b.totalHighCents));
});

// ── gates on the built estimate ────────────────────────────────────────────

test("a catalog-only estimate passes every gate", () => {
  const b = buildEstimate(
    {
      catalog_lines: [
        { catalogId: CATALOG[0].id, qty: 10 },
        { catalogId: CATALOG[1].id, qty: 4 },
        { catalogId: CATALOG[2].id, qty: 2 },
      ],
      delivery: { low: 85, high: 145 },
    },
    CATALOG,
    { taxRateBps: TAX }
  );
  const v = verifyBuild(b);
  assert.equal(
    v.errors.length,
    0,
    "unexpected: " + v.errors.map((e) => `${e.gate}: ${e.detail}`).join(" | ")
  );
});

test("catalog prices are never flagged by bounds, even when unusual", () => {
  // The shop deliberately pays a premium. That is their call, not the gate's.
  const pricey = [mat({ id: CATALOG[0].id, name: "Shredded hardwood mulch (bulk)", unitCostCents: 9900 })];
  const b = buildEstimate({ catalog_lines: [{ catalogId: pricey[0].id, qty: 5 }] }, pricey, {
    taxRateBps: TAX,
  });
  assert.equal(verifyBuild(b).errors.filter((e) => e.gate === "bounds").length, 0);
});

test("a custom line with a banned source is caught", () => {
  const b = buildEstimate(
    {
      custom_lines: [
        { name: "Mystery item", unit: "each", qty: 1, low: 10, high: 20, source: "Homewyse" },
      ],
    },
    CATALOG,
    { taxRateBps: TAX }
  );
  assert.ok(verifyBuild(b).errors.some((e) => e.gate === "sources"));
});

test("a 10x quantity slip is surfaced as a warning", () => {
  const b = buildEstimate(
    { catalog_lines: [{ catalogId: CATALOG[0].id, qty: 450 }] },
    CATALOG,
    { taxRateBps: TAX }
  );
  const v = verifyBuild(b);
  assert.ok(v.warnings.some((w) => w.gate === "quantities"));
});

test("a mostly-researched estimate warns about thin catalog coverage", () => {
  const b = buildEstimate(
    {
      catalog_lines: [{ catalogId: CATALOG[0].id, qty: 2 }],
      custom_lines: [
        { name: "Item A", unit: "each", qty: 1, low: 10, high: 12, source: "Yard – Town" },
        { name: "Item B", unit: "each", qty: 1, low: 10, high: 12, source: "Yard – Town" },
        { name: "Item C", unit: "each", qty: 1, low: 10, high: 12, source: "Yard – Town" },
      ],
    },
    CATALOG,
    { taxRateBps: TAX }
  );
  assert.ok(verifyBuild(b).warnings.some((w) => w.gate === "catalog_coverage"));
});

test("a custom line duplicating a catalog material is caught", () => {
  const b = buildEstimate(
    {
      catalog_lines: [{ catalogId: CATALOG[0].id, qty: 5 }],
      custom_lines: [
        {
          name: "Hardwood mulch, bulk",
          unit: "cu yd",
          qty: 3,
          low: 40,
          high: 44,
          source: "Other Yard – Town",
        },
      ],
    },
    CATALOG,
    { taxRateBps: TAX }
  );
  assert.ok(verifyBuild(b).errors.some((e) => e.gate === "duplicates"));
});
