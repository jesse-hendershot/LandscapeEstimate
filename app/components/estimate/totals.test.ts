/**
 * The screen's live totals must equal the server's.  npx tsx --test app/components/estimate/totals.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { Material } from "@/lib/db/schema";
import { buildEstimate, toLineItems } from "@/lib/estimate/build";
import { bottomFrom, computeTotals, isMaterialRow } from "./totals";

const m = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Mulch",
  unit: "cu yd",
  unitCostCents: 3800,
  supplier: "",
  supplierLocation: "",
} as Material;

test("client totals match the server's cents exactly", () => {
  for (const [qty, delivery, taxHaul] of [
    [10.1, 85, true],
    [3.333, 0, false],
    [47.5, 212.37, true],
  ] as const) {
    const built = buildEstimate(
      {
        catalog_lines: [{ catalogId: m.id, qty }],
        custom_lines: [{ name: "Hosta", unit: "each", qty: 7, low: 8.99, high: 12.49, source: "Nursery – Town" }],
        delivery: { low: delivery, high: delivery },
      },
      [m],
      { taxRateBps: 700, taxHaul }
    );
    const items = toLineItems(built, 700, { taxHaul });
    const t = computeTotals(items.filter(isMaterialRow), bottomFrom(items), { ratePct: 7, haul: taxHaul, deposits: false });
    assert.equal(Math.round(t.grandLow * 100), built.totalLowCents);
    assert.equal(Math.round(t.grandHigh * 100), built.totalHighCents);
    assert.equal(Math.round(t.taxLow * 100), built.taxLowCents);
  }
});
