/**
 * Machine fuel, gas trucks, trailers and machine trips.
 * npx tsx --test lib/haul/machines.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { EquipmentRow, TrailerRow, TruckRow } from "../db/schema";
import { toMachine, toTruck } from "../estimate/locality";
import { equipmentBlock, systemPrompt } from "../estimate/prompt";
import { offroadFrom, ROAD_TAX_CENTS, type FuelPrices } from "./fuel";
import { machineFuel, machineLabel, normalizeUses, roundHours } from "./machines";
import { planHaul, type Truck } from "./plan";

const now = new Date();

const FUEL: FuelPrices = {
  diesel: { centsPerGal: 668, period: "2026-09-21", source: "eia", label: "$6.68" },
  gas: { centsPerGal: 439, period: "2026-09-21", source: "eia", label: "$4.39" },
  offroad: { centsPerGal: 611, period: "2026-09-21", source: "derived", label: "$6.11" },
};

function truckRow(over: Partial<TruckRow> & { id: string; name: string }): TruckRow {
  return {
    ownerId: "u",
    kind: "pickup",
    fuel: "diesel",
    trailerId: null,
    capacityTonsMilli: 1000,
    capacityCuYdMilli: 1000,
    mpgTenths: 110,
    costPerHourCents: 4000,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function trailerRow(over: Partial<TrailerRow> & { id: string; name: string }): TrailerRow {
  return {
    ownerId: "u",
    kind: "dump",
    capacityTonsMilli: 5000,
    capacityCuYdMilli: 4000,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function machineRow(over: Partial<EquipmentRow> & { id: string; name: string }): EquipmentRow {
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

// ── trucks and trailers ────────────────────────────────────────────────────

test("a diesel pickup pulling a dump trailer hauls the trailer's load, named for both", () => {
  const trailers = new Map([["tr1", trailerRow({ id: "tr1", name: "7x14 dump trailer" })]]);
  const t = toTruck(truckRow({ id: "t1", name: "F-350", trailerId: "tr1" }), trailers, FUEL);
  assert.equal(t.kind, "dump");
  assert.equal(t.capacityTons, 5);
  assert.equal(t.capacityCuYd, 4);
  assert.equal(t.name, "F-350 + 7x14 dump trailer");
  assert.equal(t.fuelCentsPerGal, 668);
});

test("a gas F-150 with no trailer is the store-run truck, costed at gas", () => {
  const t = toTruck(truckRow({ id: "t2", name: "F-150", fuel: "gas" }), new Map(), FUEL);
  assert.equal(t.kind, "pickup");
  assert.equal(t.fuelCentsPerGal, 439);
});

test("an equipment trailer doesn't turn a pickup into a rock hauler", () => {
  const trailers = new Map([["tr2", trailerRow({ id: "tr2", name: "Equipment trailer", kind: "equipment" })]]);
  const t = toTruck(truckRow({ id: "t3", name: "F-250", trailerId: "tr2" }), trailers, FUEL);
  assert.equal(t.kind, "pickup");
  assert.equal(t.capacityTons, 1);
});

test("store runs use the gas pickup's price; bulk loads use the diesel rig's", () => {
  const rig: Truck = { id: "r", name: "Rig", kind: "dump", capacityTons: 5, capacityCuYd: 4, mpg: 10, costPerHourCents: 0, fuelCentsPerGal: 668 };
  const f150: Truck = { id: "p", name: "F-150", kind: "pickup", capacityTons: 1, capacityCuYd: 1, mpg: 20, costPerHourCents: 0, fuelCentsPerGal: 439 };
  const plan = planHaul(
    [
      { key: "0", material: "Rock", mode: "dump", tons: 4, cuYd: 3, supplierKey: "q", oneWayMiles: 10 },
      { key: "1", material: "Pipe", mode: "pickup", supplierKey: "m", oneWayMiles: 5 },
    ],
    [rig, f150],
    { dieselCentsPerGal: 999, avgMph: 30, loadMinutes: 0, pickupStopMinutes: 0, trucksForJob: 1, shopMiles: null }
  );
  // 20 mi / 10 mpg x $6.68 — the rig's own diesel, not the 999 in settings
  assert.equal(plan.lines[0].fuelCents, 1336);
  // 10 mi / 20 mpg x $4.39
  assert.equal(plan.pickupStops[0].cents, 220);
});

// ── machine trips ──────────────────────────────────────────────────────────

test("hauling a machine out and back is a shop round trip per trip, with loading time", () => {
  const rig: Truck = { id: "r", name: "Rig", kind: "dump", capacityTons: 5, capacityCuYd: 4, mpg: 10, costPerHourCents: 6000, fuelCentsPerGal: 600 };
  const plan = planHaul([], [rig], { dieselCentsPerGal: 600, avgMph: 30, loadMinutes: 15, pickupStopMinutes: 0, trucksForJob: 1, shopMiles: 9 }, [
    { key: "m1", name: "Skid steer", trips: 1, truckId: "r" },
  ]);
  const m = plan.mobilization[0];
  assert.equal(m.miles, 18);
  // fuel 18/10 x $6 = $10.80; time (18/30 h + 15 min) x $60 = $51.00
  assert.equal(m.cents, 1080 + 5100);
  assert.equal(plan.totalCents, m.cents);
  assert.equal(plan.commute.trucks, 0); // the trip IS the shop round trip
});

test("no shop address: machine trips aren't invented", () => {
  const rig: Truck = { id: "r", name: "Rig", kind: "dump", capacityTons: 5, capacityCuYd: 4, mpg: 10, costPerHourCents: 6000 };
  const plan = planHaul([], [rig], { dieselCentsPerGal: 600, avgMph: 30, loadMinutes: 15, pickupStopMinutes: 0, trucksForJob: 1, shopMiles: null }, [
    { key: "m1", name: "Skid steer", trips: 1 },
  ]);
  assert.equal(plan.mobilization.length, 0);
  assert.ok(plan.warnings.some((w) => /machines out/.test(w)));
});

// ── machine fuel ───────────────────────────────────────────────────────────

test("machine hours: known machines only, merged, quarter-hour rounding", () => {
  const machines = [{ id: "a" }, { id: "b" }];
  const { uses, unknown } = normalizeUses(
    [
      { equipmentId: "a", hours: 1.1, basis: "dig" },
      { equipmentId: "a", hours: 0.6, basis: "backfill" },
      { equipmentId: "zzz", hours: 3 },
      { equipmentId: "b", hours: 0 },
      "junk",
    ],
    machines
  );
  assert.deepEqual(uses, [{ equipmentId: "a", hours: 1.75, basis: "dig; backfill" }]);
  assert.equal(unknown, 1);
  assert.equal(roundHours(-2), 0);
  assert.equal(roundHours(999), 200);
});

test("machine fuel is hours x gal/hr x that fuel's price", () => {
  const machines = [
    toMachine(machineRow({ id: "ss", name: "Skid steer", galPerHourTenths: 30 })),
    toMachine(machineRow({ id: "mx", name: "Mini ex", galPerHourTenths: 15, fuel: "diesel" })),
  ];
  const r = machineFuel(
    [
      { equipmentId: "ss", hours: 6 },
      { equipmentId: "mx", hours: 2.5 },
    ],
    machines,
    { diesel: 668, gas: 439, offroad: 611 }
  );
  // 18 gal x $6.11 = $109.98 ; 3.75 gal x $6.68 = $25.05
  assert.equal(r.lines[0].cents, 10998);
  assert.equal(r.lines[1].cents, 2505);
  assert.equal(r.totalCents, 13503);
  assert.equal(machineLabel(r.lines), "Skid steer 6 hr, Mini ex 2.5 hr · off-road diesel $6.11, diesel $6.68");
});

test("a machine with no trailer set isn't hauled", () => {
  assert.equal(toMachine(machineRow({ id: "x", name: "Tractor", trailerId: null, haulTrips: 2 })).haulTrips, 0);
  assert.equal(toMachine(machineRow({ id: "y", name: "Skid", trailerId: "tr2", haulTrips: 2 })).haulTrips, 2);
});

test("off-road diesel: road diesel less road taxes, unless the shop sets it", () => {
  assert.equal(ROAD_TAX_CENTS, 57);
  assert.equal(offroadFrom(FUEL.diesel, 0).centsPerGal, 611);
  assert.equal(offroadFrom(FUEL.diesel, 0).source, "derived");
  assert.equal(offroadFrom(FUEL.diesel, 575).centsPerGal, 575);
});

// ── prompt ─────────────────────────────────────────────────────────────────

test("the prompt lists the shop's machines by id, and asks for hours only when there are some", () => {
  const eq = [machineRow({ id: "11111111-2222-3333-4444-555555555555", name: "Bobcat T66", kind: "track_loader" })];
  assert.match(equipmentBlock(eq), /id: 11111111-2222-3333-4444-555555555555 \| Bobcat T66 \(compact track loader\)/);
  assert.match(systemPrompt([], [], eq), /RULE 7 — MACHINE HOURS/);
  assert.match(systemPrompt([], [], eq), /"machines": \[/);
  assert.doesNotMatch(systemPrompt([], [], []), /RULE 7/);
});
