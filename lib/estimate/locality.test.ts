/**
 * End-to-end locality tests: model output -> built estimate -> substitutes,
 * haul plan, deposits, tax scope. No network: every supplier here has
 * coordinates and no routing key is set, so distances are the offline
 * estimate.  npx tsx --test lib/estimate/locality.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { EquipmentRow, Material, Supplier, TrailerRow, TruckRow } from "../db/schema";
import { applyBps } from "../money";
import { buildEstimate, stripIds, toLineItems, type BuildOptions } from "./build";
import { applyLocality, matchSupplier, storeBrand } from "./locality";

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
    fuel: "diesel",
    trailerId: null,
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
const FUEL = {
  diesel: DIESEL,
  gas: { centsPerGal: 350, period: "2026-09-21", source: "manual" as const, label: "$3.50/gal (test)" },
  offroad: { centsPerGal: 343, period: "2026-09-21", source: "derived" as const, label: "$3.43/gal (test)" },
};

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
    fuel: FUEL,
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
    job: JOB, trucksForJob: 1, fuel: FUEL, bias: "", buildOpts: opts,
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
    job: JOB, trucksForJob: 1, fuel: FUEL, bias: "", buildOpts: OPTS,
  });
  assert.ok(detail.warnings.some((w) => /assumed 15 mi/.test(w)), detail.warnings.join(" | "));
});

test("store names reduce to the store, not the branch or address", () => {
  assert.equal(storeBrand("Menards – Iowa City, 2501 Muscatine Ave"), "menards");
  assert.equal(storeBrand("Menards Iowa City"), "menards iowa city");
  assert.equal(storeBrand("The Home Depot - Coralville"), "home depot");
  assert.equal(storeBrand("Conklin Quarry and Mill"), "conklin quarry and mill");
});

test("a researched line from a store on file uses that store's real location", () => {
  const m = matchSupplier("Menards – Iowa City, 2501 Muscatine Ave", SUPPLIERS, JOB);
  assert.equal(m?.id, "sM");
  assert.equal(matchSupplier("Lowe's of Cedar Rapids", SUPPLIERS, JOB), null);
  // Two branches: the nearer one
  const two = [...SUPPLIERS, supplier("sM2", "Menards – Cedar Rapids", north(25), { kind: "big_box" })];
  assert.equal(matchSupplier("Menards", two, JOB)?.id, "sM");
});

test("researched store items join the catalog's stop at the same store", async () => {
  const { built, detail } = await run({
    catalog_lines: [{ catalogId: "fabric", qty: 1 }],
    custom_lines: [
      { name: "4 in sock pipe, 100 ft", unit: "roll", qty: 1, low: 55, high: 90, source: "Menards – Iowa City, 2501 Muscatine Ave" },
      { name: "Pop-up emitter", unit: "each", qty: 1, low: 20, high: 25, source: "Menards Iowa City" },
    ],
  });
  const stops = detail.plan?.pickupStops ?? [];
  assert.equal(stops.length, 1, JSON.stringify(stops));
  assert.equal(stops[0].lines, 3);
  assert.ok(stops[0].miles > 7 && stops[0].miles < 9, `miles ${stops[0].miles}`); // 3 mi x 1.3, there and back
  assert.equal(built.lines[1].source, "Menards Iowa City");
  assert.ok(!detail.warnings.some((w) => /assumed/.test(w)), detail.warnings.join(" | "));
});

test("catalog ids are scrubbed out of the model's notes", () => {
  assert.equal(
    stripIds("Uses Clean stone 1 in (id 29c48214) and River rock (id 40e424de-1111-2222-3333-444455556666)."),
    "Uses Clean stone 1 in and River rock."
  );
});

// ── machines ───────────────────────────────────────────────────────────────

function machine(over: Partial<EquipmentRow> & { id: string; name: string }): EquipmentRow {
  return {
    ownerId: "u",
    kind: "skid_steer",
    fuel: "offroad",
    galPerHourTenths: 30,
    trailerId: null,
    haulTrips: 1,
    notes: "",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const EQ_TRAILER: TrailerRow = {
  id: "trE",
  ownerId: "u",
  name: "Equipment trailer",
  kind: "equipment",
  capacityTonsMilli: 7000,
  capacityCuYdMilli: 0,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

test("machine fuel is its own taxed row, and hauling the machine out is hauling", async () => {
  const equipment = [machine({ id: "ss", name: "Skid steer", trailerId: "trE", haulTrips: 1 })];
  const built0 = buildEstimate({ catalog_lines: [{ catalogId: "near", qty: 5 }] }, CATALOG, OPTS);
  const without = await applyLocality({
    built: built0, catalog: CATALOG, suppliers: SUPPLIERS, trucks: TRUCKS, profile: PROFILE,
    job: JOB, trucksForJob: 1, fuel: FUEL, bias: "", buildOpts: OPTS,
  });
  const { built, detail } = await applyLocality({
    built: built0, catalog: CATALOG, suppliers: SUPPLIERS, trucks: TRUCKS, profile: PROFILE,
    trailers: [EQ_TRAILER], equipment, machines: [{ equipmentId: "ss", hours: 4 }],
    job: JOB, trucksForJob: 1, fuel: FUEL, bias: "", buildOpts: OPTS,
  });
  // 4 hr x 3 gal/hr x $3.43 off-road
  assert.equal(built.machineCents, 4116);
  assert.equal(detail.machines?.[0].gallons, 12);
  // One trip out and back with the lead truck, on top of the rock haul
  assert.equal(detail.plan?.mobilization?.length, 1);
  assert.equal(detail.plan?.mobilization?.[0].trips, 1);
  assert.ok(built.deliveryLowCents > without.built.deliveryLowCents);
  assert.match(built.haulLabel, /1 machine trip/);
  // Taxed with hauling
  assert.equal(built.taxLowCents, applyBps(built.subtotalLowCents + built.deliveryLowCents + built.machineCents, 700));
  assert.equal(built.totalLowCents, built.subtotalLowCents + built.deliveryLowCents + built.machineCents + built.depositCents + built.taxLowCents);

  const items = toLineItems(built, 700, OPTS);
  const row = items.find((i) => i.kind === "machine")!;
  assert.equal(row.low, 41.16);
  assert.match(row.source, /Skid steer 4 hr · off-road diesel \$3\.43/);
  assert.match(items.find((i) => i.kind === "tax")!.source, /hauling \+ machine fuel/);
});

test("machine fuel isn't taxed when hauling isn't", async () => {
  const opts = { ...OPTS, taxHaul: false };
  const built0 = buildEstimate({ catalog_lines: [{ catalogId: "near", qty: 5 }] }, CATALOG, opts);
  const { built } = await applyLocality({
    built: built0, catalog: CATALOG, suppliers: SUPPLIERS, trucks: TRUCKS, profile: PROFILE,
    equipment: [machine({ id: "ss", name: "Skid steer" })], machines: [{ equipmentId: "ss", hours: 2 }],
    job: JOB, trucksForJob: 1, fuel: FUEL, bias: "", buildOpts: opts,
  });
  assert.ok(built.machineCents > 0);
  assert.equal(built.taxLowCents, applyBps(built.subtotalLowCents, 700));
});

test("the truck that pulls the equipment trailer is the one that hauls the machine", async () => {
  const trucks = [...TRUCKS, truck({ id: "t9", name: "F-350", kind: "pickup", trailerId: "trE", mpgTenths: 120 })];
  const { detail } = await applyLocality({
    built: buildEstimate({}, CATALOG, OPTS), catalog: CATALOG, suppliers: SUPPLIERS, trucks, profile: PROFILE,
    trailers: [EQ_TRAILER], equipment: [machine({ id: "ss", name: "Skid steer", trailerId: "trE" })],
    machines: [{ equipmentId: "ss", hours: 3 }],
    job: JOB, trucksForJob: 1, fuel: FUEL, bias: "", buildOpts: OPTS,
  });
  assert.equal(detail.plan?.mobilization?.[0].truckName, "F-350");
});

test("no job location: machine fuel still counts", async () => {
  const { built } = await run(
    { catalog_lines: [{ catalogId: "sod", qty: 450 }] },
    { job: null, equipment: [machine({ id: "ss", name: "Skid steer" })], machines: [{ equipmentId: "ss", hours: 1 }] }
  );
  assert.equal(built.machineCents, 1029);
});

// ── supplier prices over starter placeholders ──────────────────────────────

test("a starter pick is swapped for the supplier's sheet price, labelled, with no savings claim", async () => {
  const catalog = [
    mat({ id: "st", name: "Drain rock (starter)", supplierId: "sA", specClass: "Drain rock", unitCostCents: 1500, priceSource: "starter", priceSourceLabel: "Starter price" }),
    mat({
      id: "sh",
      name: "1 in clean limestone",
      supplierId: "sB",
      specClass: "Drain rock",
      unitCostCents: 2650,
      priceSource: "sheet",
      priceSourceLabel: "Quarry B price sheet, 2026-09-29",
    }),
  ];
  const built0 = buildEstimate({ catalog_lines: [{ catalogId: "st", qty: 10 }] }, catalog, OPTS);
  assert.equal(built0.lines[0].priceSource, "starter");
  const { built, detail } = await run({ catalog_lines: [] }, { built: built0, catalog });
  const line = built.lines[0];
  assert.equal(line.materialId, "sh");
  assert.equal(line.priceSource, "sheet");
  assert.equal(line.priceLabel, "Quarry B price sheet, 2026-09-29");
  assert.equal(line.savedCents, undefined);
  assert.match(line.basis, /used Quarry B's actual price instead of the starter price/);
  assert.equal(detail.switched[0].reason, "supplier_price");
  assert.equal(line.alternatives?.[0].priceSource, "starter");

  const items = toLineItems(built, OPTS.taxRateBps, OPTS);
  assert.equal(items[0].priceSource, "sheet");
});

test("researched lines say they weren't priced by a supplier", async () => {
  const built = buildEstimate(
    { custom_lines: [{ name: "Hydrangea 3 gal", qty: 4, unit: "each", low: 30, high: 40, source: "Some nursery" }] },
    CATALOG,
    OPTS
  );
  assert.equal(built.lines[0].priceSource, "research");
});
