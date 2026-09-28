/**
 * Locality engine tests.  npx tsx --test lib/haul/haul.test.ts
 *
 * The worked example from the first field feedback is the anchor: 20 tons of
 * drain rock, a close quarry at $24/ton versus a far one at $18/ton. The far
 * one looks $120 cheaper on paper and costs about $85 more on the ground.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { planHaul, splitLoads, fuelCents, timeCents, type Truck, type HaulSettings } from "./plan";
import { equivalentQty, haulModeFor, rankSubstitutes, type Candidate, type RankContext } from "./rank";

const TANDEM: Truck = {
  id: "t1",
  name: "Tandem",
  kind: "dump",
  capacityTons: 13,
  capacityCuYd: 10,
  mpg: 6,
  costPerHourCents: 7500,
};
const SINGLE: Truck = { ...TANDEM, id: "t2", name: "Single axle", capacityTons: 7, capacityCuYd: 5, mpg: 8, costPerHourCents: 6000 };
const PICKUP: Truck = { id: "p1", name: "Pickup", kind: "pickup", capacityTons: 1.5, capacityCuYd: 1.5, mpg: 15, costPerHourCents: 4500 };

const S: HaulSettings = {
  dieselCentsPerGal: 400,
  avgMph: 45,
  loadMinutes: 0,
  pickupStopMinutes: 0,
  trucksForJob: 1,
  shopMiles: null,
};

// ── primitives ─────────────────────────────────────────────────────────────

test("fuel and time are rounded to the cent once", () => {
  assert.equal(fuelCents(16, 6, 400), 1067); // 2.667 gal x $4
  assert.equal(timeCents(16 / 45, 7500), 2667);
  assert.equal(fuelCents(0, 6, 400), 0);
  assert.equal(fuelCents(10, 0, 400), 0);
});

test("a load a hair over capacity does not become a second trip", () => {
  assert.equal(splitLoads(13.1, 9.7, [TANDEM]).length, 1);
  assert.equal(splitLoads(14, 10.4, [TANDEM]).length, 2);
});

test("volume can bind before weight (light material fills the bed first)", () => {
  // Mulch: 0.3 ton/yd. 10 yd bed holds 3 tons, far under 13.
  const loads = splitLoads(6, 20, [TANDEM]);
  assert.equal(loads.length, 2);
  assert.ok(Math.abs(loads[0].tons - 3) < 1e-9);
});

test("loads round-robin across trucks, biggest first", () => {
  const loads = splitLoads(30, 22, [SINGLE, TANDEM]);
  assert.deepEqual(
    loads.map((l) => l.truckId),
    ["t1", "t2", "t1"]
  );
  const total = loads.reduce((a, l) => a + l.tons, 0);
  assert.ok(Math.abs(total - 30) < 1e-9);
});

// ── the field-feedback example ─────────────────────────────────────────────

const drainRock = (over: Partial<Candidate>): Candidate => ({
  id: "x",
  name: "3/4 clean limestone",
  category: "aggregate",
  unit: "ton",
  unitCostCents: 2400,
  specClass: "Drain rock",
  haul: "auto",
  supplierId: null,
  supplierName: "",
  deliveryFeeCents: 0,
  tonsPerCuYdMilli: 1350,
  ...over,
});

const NEAR = drainRock({ id: "near", supplierId: "sA", supplierName: "Quarry A", unitCostCents: 2400 });
const FAR = drainRock({ id: "far", name: "#57 stone", supplierId: "sB", supplierName: "Quarry B", unitCostCents: 1800 });

function ctx(over: Partial<RankContext> = {}): RankContext {
  return {
    distanceFor: (c) =>
      c.supplierId === "sA"
        ? { miles: 8, approx: false, basis: "supplier" }
        : c.supplierId === "sB"
          ? { miles: 30, approx: false, basis: "supplier" }
          : null,
    defaultMiles: 15,
    dumpTrucks: [TANDEM],
    pickupTruck: PICKUP,
    settings: S,
    ...over,
  };
}

test("the far quarry is $120 cheaper on paper and ~$85 dearer delivered", () => {
  // Model picked the far, cheaper-looking rock.
  const r = rankSubstitutes(FAR, 20_000, [NEAR, FAR], ctx());
  assert.equal(r.switched, true);
  assert.equal(r.chosen.materialId, "near");
  assert.equal(r.chosen.materialCents, 48_000);
  assert.equal(r.chosen.haulCents, 2 * (1067 + 2667)); // 2 loads, 16 mi round trips
  assert.equal(r.chosen.landedCents, 55_468);

  const far = r.alternatives.find((a) => a.materialId === "far")!;
  assert.equal(far.materialCents, 36_000);
  assert.equal(far.haulCents, 2 * (4000 + 10000)); // 60 mi round trips
  assert.equal(far.landedCents, 64_000);
  assert.equal(r.savedCents, 8_532);
});

test("the model's pick stands when a substitute saves less than the threshold", () => {
  const twin = drainRock({ id: "twin", supplierId: "sA", supplierName: "Quarry A", unitCostCents: 2390 });
  const r = rankSubstitutes(NEAR, 20_000, [NEAR, twin], ctx());
  assert.equal(r.switched, false);
  assert.equal(r.chosen.materialId, "near");
  assert.equal(r.alternatives[0].materialId, "twin");
});

test("materials outside the class are never offered", () => {
  const mulch = drainRock({ id: "m", name: "Hardwood mulch", unit: "cu yd", specClass: "Mulch", unitCostCents: 100 });
  const r = rankSubstitutes(NEAR, 20_000, [NEAR, mulch], ctx());
  assert.equal(r.alternatives.length, 0);
});

test("a material with no class is priced but has no alternatives", () => {
  const solo = drainRock({ id: "solo", specClass: "", supplierId: "sA" });
  const r = rankSubstitutes(solo, 5_000, [solo, NEAR], ctx());
  assert.equal(r.chosen.materialId, "solo");
  assert.equal(r.alternatives.length, 0);
  assert.ok(r.chosen.haulCents > 0);
});

test("unknown supplier location falls back to the default distance, flagged", () => {
  const nowhere = drainRock({ id: "n", supplierId: null });
  const r = rankSubstitutes(nowhere, 5_000, [nowhere], ctx());
  assert.equal(r.chosen.miles, null);
  assert.equal(r.chosen.distance?.basis, "assumed");
  assert.equal(r.chosen.distance?.miles, 15);
});

test("bulk substitutes convert through loose volume by each material's density", () => {
  const yards = drainRock({ id: "y", unit: "cu yd", tonsPerCuYdMilli: 1400 });
  // 14 tons of 1.35 t/yd rock = 10.37 yd -> round up to 10.5 yd
  assert.equal(equivalentQty(NEAR, 14_000, yards), 10_500);
  // and back: 10 yd at 1.4 t/yd picked -> 1.35 t/yd candidate: 10 yd x 1.35 = 13.5 t
  assert.equal(equivalentQty(yards, 10_000, NEAR), 13_500);
  // bag vs ton is not comparable
  assert.equal(equivalentQty(NEAR, 1000, { ...NEAR, unit: "bag" }), null);
});

test("haul mode: bulk units ride the dump truck, the rest are store runs", () => {
  assert.equal(haulModeFor({ haul: "auto", unit: "ton" }), "dump");
  assert.equal(haulModeFor({ haul: "auto", unit: "cu yd" }), "dump");
  assert.equal(haulModeFor({ haul: "auto", unit: "roll" }), "pickup");
  assert.equal(haulModeFor({ haul: "delivered", unit: "sq ft" }), "delivered");
  assert.equal(haulModeFor({ haul: "none", unit: "ton" }), "none");
});

// ── whole-job plan ─────────────────────────────────────────────────────────

test("shop miles are added once per truck that works the job", () => {
  const plan = planHaul(
    [{ key: "0", material: "rock", mode: "dump", tons: 20, cuYd: 14.8, supplierKey: "sA", oneWayMiles: 8 }],
    [TANDEM],
    { ...S, shopMiles: 5 }
  );
  assert.equal(plan.totalLoads, 2);
  assert.equal(plan.commute.trucks, 1);
  assert.equal(plan.commute.miles, 10);
  // 10 mi: fuel 10/6*$4 = 666.67 -> 667; time 10/45 h * $75 = 1666.67 -> 1667
  assert.equal(plan.commute.cents, 667 + 1667);
  assert.equal(plan.totalCents, 2 * (1067 + 2667) + 2334);
});

test("two trucks split the loads and each adds its own shop trip", () => {
  const one = planHaul(
    [{ key: "0", material: "rock", mode: "dump", tons: 26, cuYd: 19.3, supplierKey: "sA", oneWayMiles: 8 }],
    [TANDEM, { ...TANDEM, id: "t3", name: "Tandem 2" }],
    { ...S, shopMiles: 5, trucksForJob: 1 }
  );
  const two = planHaul(
    [{ key: "0", material: "rock", mode: "dump", tons: 26, cuYd: 19.3, supplierKey: "sA", oneWayMiles: 8 }],
    [TANDEM, { ...TANDEM, id: "t3", name: "Tandem 2" }],
    { ...S, shopMiles: 5, trucksForJob: 2 }
  );
  assert.equal(one.commute.trucks, 1);
  assert.equal(two.commute.trucks, 2);
  assert.equal(one.totalLoads, two.totalLoads);
  assert.equal(two.totalCents - one.totalCents, 2334); // one extra shop round trip
});

test("store runs are one trip per supplier, however many lines", () => {
  const plan = planHaul(
    [
      { key: "0", material: "fabric", mode: "pickup", supplierKey: "menards", supplierName: "Menards", oneWayMiles: 4 },
      { key: "1", material: "staples", mode: "pickup", supplierKey: "menards", supplierName: "Menards", oneWayMiles: 4 },
      { key: "2", material: "pipe", mode: "pickup", supplierKey: "ferguson", supplierName: "Ferguson", oneWayMiles: 6 },
    ],
    [TANDEM, PICKUP],
    S
  );
  assert.equal(plan.pickupStops.length, 2);
  const menards = plan.pickupStops.find((p) => p.supplierKey === "menards")!;
  assert.deepEqual(menards.lineKeys, ["0", "1"]);
  // Per-line shares sum back to the stop exactly.
  const shares = plan.lines.filter((l) => l.key === "0" || l.key === "1").reduce((a, l) => a + l.haulCents, 0);
  assert.equal(shares, menards.cents);
  assert.equal(plan.trucksUsed.length, 1);
  assert.equal(plan.trucksUsed[0].id, "p1");
});

test("supplier-delivered lines cost the delivery fee and no truck time", () => {
  const plan = planHaul(
    [{ key: "0", material: "sod", mode: "delivered", supplierKey: "sod", oneWayMiles: 20, deliveryFeeCents: 7500 }],
    [TANDEM],
    { ...S, shopMiles: 5 }
  );
  assert.equal(plan.totalCents, 7500);
  assert.equal(plan.commute.trucks, 0);
});

test("missing trucks and locations produce warnings, never silent zeros", () => {
  const plan = planHaul(
    [
      { key: "0", material: "rock", mode: "dump", tons: 5, cuYd: 3.7, supplierKey: "a", oneWayMiles: 8 },
      { key: "1", material: "mystery", mode: "dump", tons: 5, cuYd: 3.7, supplierKey: "b", oneWayMiles: null },
    ],
    [],
    S
  );
  assert.equal(plan.totalCents, 0);
  assert.ok(plan.warnings.some((w) => /No dump truck/.test(w)));
  assert.ok(plan.warnings.some((w) => /No location/.test(w)));
});
