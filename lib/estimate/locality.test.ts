/**
 * End-to-end locality tests: model output -> built estimate -> substitutes,
 * haul plan, deposits, tax scope. No network: every supplier here has
 * coordinates and no routing key is set, so distances are the offline
 * estimate.  npx tsx --test lib/estimate/locality.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { Material, Supplier, TruckRow } from "../db/schema";
import { applyBps } from "../money";
import { buildEstimate, stripIds, toLineItems, type BuildOptions } from "./build";
import { applyLocality } from "./locality";

delete process.env.OPENROUTESERVICE_API_KEY;

const JOB = { lat: 41.66, lng: -91.53 };
const MI_LAT = 1 / 69.0934; // degrees of latitude per mile
const north = (miles: number) => ({ lat: JOB.lat + miles * MI_LAT, lng: JOB.lng });

const now = new Date();

function supplier(id: string, name: string, at: { lat: number; lng: number } | null, over: Partial<Supplier> = {}): Supplier {
  return {
    id,
    ownerId: "u",
    name,
    kind: "quarry",
    address: "",
    lat: at?.lat ?? null,
    lng: at?.lng ?? null,
    phone: "",
    notes: "",
    deliveryFeeCents: 0,
    mshaId: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function mat(over: Partial<Material> & { id: string; name: string }): Material {
  return {
    ownerId: "u",
    category: "aggregate",
    unit: "ton",
    unitCostCents: 2400,
    supplier: "",
    supplierLocation: "",
    sku: null,
    coverage: "",
    notes: "",
    supplierId: null,
    specClass: "",
    tonsPerCuYdMilli: 1350,
    haul: "auto",
    unitsPerPalletMilli: null,
    palletDepositCents: 0,
    isActive: true,
    useCount: 0,
    priceUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as Material;
}

function truck(over: Partial<TruckRow> & { id: string; name: string }): TruckRow {
  return {
    ownerId: "u",
    kind: "dump",
    capacityTonsMilli: 13000,
    capacityCuYdMilli: 10000,
    mpgTenths: 60,
    costPerHourCents: 7500,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const SUPPLIERS = [
  supplier("sA", "Quarry A", north(8 / 1.3)), // ~8 road miles
  supplier("sB", "Quarry B", north(30 / 1.3)), // ~30 road miles
  supplier("sSod", "Sod Farm", north(20), { kind: "sod_farm", deliveryFeeCents: 7500 }),
  supplier("sM", "Menards Iowa City", north(3), { kind: "big_box" }),
];

const CATALOG = [
  mat({ id: "near", name: "3/4 clean limestone", supplierId: "sA", specClass: "Drain rock", unitCostCents: 2400 }),
  mat({ id: "far", name: "#57 stone", supplierId: "sB", specClass: "Drain rock", unitCostCents: 1800 }),
  mat({
    id: "sod",
    name: "Bluegrass sod",
    category: "sod",
    unit: "sq ft",
    unitCostCents: 52,
    supplierId: "sSod",
    haul: "delivered",
    unitsPerPalletMilli: 450_000,
    palletDepositCents: 1000,
    tonsPerCuYdMilli: null,
  }),
  mat({ id: "fabric", name: "Filter fabric roll", category: "fabric", unit: "roll", unitCostCents: 3800, supplierId: "sM", tonsPerCuYdMilli: null }),
];

const TRUCKS = [
  truck({ id: "t1", name: "Tandem" }),
  truck({ id: "p1", name: "Pickup", kind: "pickup", capacityTonsMilli: 1500, capacityCuYdMilli: 1500, mpgTenths: 150, costPerHourCents: 4500 }),
];

const PROFILE = {
  avgMph: 45,
  loadMinutes: 0,
  pickupStopMinutes: 0,
  defaultHaulMiles: 15,
  shopLat: north(5 / 1.3).lat,
  shopLng: JOB.lng,
};

const OPTS: BuildOptions = { taxRateBps: 700, taxHaul: true, taxDeposits: false };

const DIESEL = { centsPerGal: 400, period: "2026-09-21", source: "manual" as const, label: "$4.00/gal (test)" };

async function run(modelOut: Parameters<typeof buildEstimate>[0], over: Partial<Parameters<typeof applyLocality>[0]> = {}) {
  const built = buildEstimate(modelOut, CATALOG, OPTS);
  return applyLocality({
    built,
    catalog: CATALOG,
    suppliers: SUPPLIERS,
    trucks: TRUCKS,
    profile: PROFILE,
    job: JOB,
    trucksForJob: 1,
    diesel: DIESEL,
    bias: "Iowa City, IA",
    buildOpts: OPTS,
    ...over,
  });
}

test("the far, cheaper-looking rock is swapped for the near one", async () => {
  const { built, detail } = await run({ catalog_lines: [{ catalogId: "far", qty: 20 }] });
  const line = built.lines[0];
  assert.equal(line.materialId, "near");
  assert.equal(line.replaced, "#57 stone");
  assert.ok((line.savedCents ?? 0) > 5000, `saved ${line.savedCents}`);
  assert.equal(line.alternatives?.[0].materialId, "far");
  assert.equal(detail.switched.length, 1);
  assert.equal(line.source, "Quarry A");
});

test("hauling is computed: loads, shop trip, and a label that says so", async () => {
  const { built, detail } = await run({ catalog_lines: [{ catalogId: "near", qty: 20 }] });
  assert.equal(built.haulSource, "computed");
  assert.equal(detail.plan?.totalLoads, 2);
  assert.equal(detail.plan?.commute.trucks, 1);
  assert.ok(detail.shopMiles! > 4.9 && detail.shopMiles! < 5.1);
  assert.match(built.haulLabel, /2 loads/);
  assert.match(built.haulLabel, /\(approx\)/); // no routing key in tests
  assert.equal(built.deliveryLowCents, built.deliveryHighCents);
  assert.equal(built.deliveryLowCents, detail.plan?.totalCents);
});

test("sod: delivered by the farm (fee), pallets counted and deposited", async () => {
  const { built } = await run({
    catalog_lines: [{ catalogId: "sod", qty: 800, dims: { area_sqft: 495 } }],
  });
  // 495 sq ft + 5% = 520 sq ft -> 2 pallets of 450
  assert.equal(built.lines[0].qtyMilli, 520_000);
  assert.equal(built.deposits[0].pallets, 2);
  assert.equal(built.depositCents, 2000);
  assert.equal(built.lines[0].haulCents, 7500);
  // dims beat the model's 800, and the gap is recorded
  assert.equal(built.qtyMismatches.length, 1);
});

test("store runs group by supplier, and tax scope follows the settings", async () => {
  const { built } = await run({
    catalog_lines: [
      { catalogId: "near", qty: 5 },
      { catalogId: "fabric", qty: 2 },
      { catalogId: "sod", qty: 450 },
    ],
  });
  const sub = built.subtotalLowCents;
  const haul = built.deliveryLowCents;
  const dep = built.depositCents;
  assert.equal(built.taxLowCents, applyBps(sub + haul, 700)); // hauling taxed, deposits not
  assert.equal(built.totalLowCents, sub + haul + dep + built.taxLowCents);

  const items = toLineItems(built, 700, OPTS);
  const kinds = items.map((i) => i.kind);
  assert.deepEqual(kinds.slice(-4), ["haul", "deposit", "tax", "total"]);
  assert.match(items.find((i) => i.kind === "tax")!.source, /materials \+ hauling/);
});

test("taxing deposits is a setting, off by default", async () => {
  const opts = { ...OPTS, taxDeposits: true };
  const built0 = buildEstimate({ catalog_lines: [{ catalogId: "sod", qty: 450 }] }, CATALOG, opts);
  const { built } = await applyLocality({
    built: built0, catalog: CATALOG, suppliers: SUPPLIERS, trucks: TRUCKS, profile: PROFILE,
    job: JOB, trucksForJob: 1, diesel: DIESEL, bias: "", buildOpts: opts,
  });
  assert.equal(built.taxLowCents, applyBps(built.subtotalLowCents + built.deliveryLowCents + built.depositCents, 700));
});

test("no trucks: the model's delivery guess stands, with a warning", async () => {
  const { built, detail } = await run(
    { catalog_lines: [{ catalogId: "near", qty: 5 }], delivery: { low: 90, high: 120 } },
    { trucks: [] }
  );
  assert.equal(built.haulSource, "model");
  assert.equal(built.deliveryLowCents, 9000);
  assert.ok(detail.warnings.some((w) => /No trucks set up/.test(w)));
});

test("no job location: nothing is invented, deposits still computed", async () => {
  const { built, detail } = await run({ catalog_lines: [{ catalogId: "sod", qty: 450 }] }, { job: null });
  assert.equal(built.depositCents, 1000);
  assert.ok(detail.warnings.some((w) => /Couldn't find the job address/.test(w)));
});

test("a supplier with no location uses the default distance and says so", async () => {
  const cat = [...CATALOG, mat({ id: "mystery", name: "Pea gravel", supplierId: null, unitCostCents: 4800 })];
  const built0 = buildEstimate({ catalog_lines: [{ catalogId: "mystery", qty: 3 }] }, cat, OPTS);
  const { detail } = await applyLocality({
    built: built0, catalog: cat, suppliers: SUPPLIERS, trucks: TRUCKS, profile: PROFILE,
    job: JOB, trucksForJob: 1, diesel: DIESEL, bias: "", buildOpts: OPTS,
  });
  assert.ok(detail.warnings.some((w) => /assumed 15 mi/.test(w)), detail.warnings.join(" | "));
});

test("catalog ids are scrubbed out of the model's notes", () => {
  assert.equal(
    stripIds("Uses Clean stone 1 in (id 29c48214) and River rock (id 40e424de-1111-2222-3333-444455556666)."),
    "Uses Clean stone 1 in and River rock."
  );
});
