/**
 * The locality step: where the materials come from, and what that costs.
 *
 * Runs after the model has picked materials and quantities. For each line it:
 *
 *   1. finds every same-class substitute in the catalog,
 *   2. prices each one DELIVERED to this job (material + that supplier's haul),
 *   3. keeps the cheapest and lists the rest as one-click swaps,
 *
 * then plans the whole haul — loads per truck, store runs, shop round trips —
 * with this week's diesel price.
 *
 * Distances come in two flavors and the UI shows which: real road miles (with
 * a routing key) or straight-line x circuity (flagged "approx"). A supplier
 * with no location at all uses the shop's default haul distance, also flagged.
 * Nothing here ever silently prices a trip at zero.
 */

import type { EquipmentRow, Material, Profile, Supplier, TrailerRow, TruckRow } from "../db/schema";
import { bulkLoad } from "../earthwork/quantity";
import { haversineMiles, type LatLng } from "../geo/geo";
import { geocodePlace, geocodeStore } from "../geo/geocode";
import { roadDistance } from "../geo/routing";
import { centsFor, type FuelKind, type FuelPrices } from "../haul/fuel";
import { machineFuel, machineLabel, type Machine, type MachineLine, type MachineUse } from "../haul/machines";
import { planHaul, type HaulLine, type HaulPlan, type Mobilization, type Truck } from "../haul/plan";
import { haulModeFor, rankSubstitutes, type Candidate, type Distance, type Priced, type RankContext } from "../haul/rank";
import { fromCents, fromMilli } from "../money";
import { mapLimit, settle } from "../net";
import { computeDeposits, computeTotals, type BuildOptions, type BuiltEstimate, type BuiltLine } from "./build";
import type { LineAlternative } from "./schema";

/**
 * A truck as the planner sees it. A truck pulling a dump trailer hauls bulk,
 * and its load is the trailer's — a pickup with a 7x14 dump trailer is a
 * 5-ton rock hauler, not a 1-ton pickup. Its miles are costed at its own fuel.
 */
export function toTruck(t: TruckRow, trailersById: Map<string, TrailerRow> = new Map(), fuel?: FuelPrices): Truck {
  const tr = t.trailerId ? trailersById.get(t.trailerId) : undefined;
  const pullsDump = Boolean(tr && tr.isActive && tr.kind === "dump");
  const ownDump = t.kind !== "pickup";
  return {
    id: t.id,
    name: pullsDump ? `${t.name} + ${tr!.name}` : t.name,
    kind: ownDump || pullsDump ? "dump" : "pickup",
    capacityTons: (pullsDump ? tr!.capacityTonsMilli : t.capacityTonsMilli) / 1000,
    capacityCuYd: (pullsDump ? tr!.capacityCuYdMilli : t.capacityCuYdMilli) / 1000,
    mpg: t.mpgTenths / 10,
    costPerHourCents: t.costPerHourCents,
    fuelCentsPerGal: fuel ? centsFor(fuel, t.fuel === "gas" ? "gas" : "diesel") : undefined,
  };
}

export function toMachine(e: EquipmentRow): Machine {
  const fuel: FuelKind = e.fuel === "gas" ? "gas" : e.fuel === "diesel" ? "diesel" : "offroad";
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    fuel,
    galPerHour: e.galPerHourTenths / 10,
    trailerId: e.trailerId,
    haulTrips: e.trailerId ? Math.max(0, e.haulTrips) : 0,
  };
}

export function toCandidate(m: Material, suppliersById: Map<string, Supplier>): Candidate {
  const s = m.supplierId ? suppliersById.get(m.supplierId) : undefined;
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    unit: m.unit,
    tonsPerCuYdMilli: m.tonsPerCuYdMilli,
    unitCostCents: m.unitCostCents,
    specClass: m.specClass ?? "",
    haul: m.haul ?? "auto",
    supplierId: m.supplierId ?? null,
    supplierName: s?.name ?? m.supplier ?? "",
    deliveryFeeCents: s?.deliveryFeeCents ?? 0,
  };
}

/**
 * The store part of a supplier name, lowercased: "Menards – Iowa City, 2501
 * Muscatine Ave" and "Menards Iowa City" both start with "menards".
 */
export function storeBrand(text: string): string {
  const head = text.split(/\s[-–—]\s|,|\(/)[0] ?? "";
  return head
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^the /, "")
    .trim();
}

/**
 * Which of the shop's own suppliers a researched line came from, if any.
 *
 * The model names the store it priced ("Menards – Iowa City, ...") but the
 * street address it attaches is often invented. When the shop already has that
 * store on file, its real location wins; with several branches, the one nearest
 * the job.
 */
export function matchSupplier(source: string, suppliers: Supplier[], job: LatLng): Supplier | null {
  const brand = storeBrand(source);
  if (brand.length < 3) return null;
  const same = (a: string, b: string) => a === b || a.startsWith(b + " ") || b.startsWith(a + " ");
  const hits = suppliers.filter(
    (s) => s.isActive && s.lat !== null && s.lng !== null && same(storeBrand(s.name), brand)
  );
  if (hits.length === 0) return null;
  const miles = (s: Supplier) => haversineMiles(job, { lat: s.lat!, lng: s.lng! });
  return hits.sort((a, b) => miles(a) - miles(b))[0];
}

export interface HaulDetail {
  diesel: { centsPerGal: number; label: string; source: string };
  /** Gas (for gas trucks) and off-road diesel (for machines), when priced. */
  fuel?: { gas: { centsPerGal: number; label: string }; offroad: { centsPerGal: number; label: string } };
  /** Machine hours and the fuel they burn. */
  machines?: MachineLine[];
  machineCents?: number;
  trucksForJob: number;
  shopMiles: number | null;
  distanceSource: "road" | "approx";
  plan: {
    totalCents: number;
    totalMiles: number;
    totalHours: number;
    totalLoads: number;
    trucksUsed: { name: string; loads: number }[];
    commute: HaulPlan["commute"];
    pickupStops: { supplier: string; miles: number; cents: number; lines: number }[];
    mobilization?: { name: string; truckName: string; trips: number; miles: number; cents: number }[];
    lines: { material: string; mode: string; loads: number; miles: number; haulCents: number; oneWayMiles: number | null; approx: boolean }[];
  } | null;
  switched: { from: string; to: string; savedCents: number }[];
  warnings: string[];
}

export interface LocalityArgs {
  built: BuiltEstimate;
  catalog: Material[];
  suppliers: Supplier[];
  trucks: TruckRow[];
  trailers?: TrailerRow[];
  equipment?: EquipmentRow[];
  /** Engine hours per machine, already normalized. */
  machines?: MachineUse[];
  profile: Pick<Profile, "avgMph" | "loadMinutes" | "pickupStopMinutes" | "defaultHaulMiles" | "shopLat" | "shopLng">;
  job: LatLng | null;
  trucksForJob: number;
  fuel: FuelPrices;
  /** "City, ST" for geocoding bare store names. */
  bias: string;
  buildOpts: BuildOptions;
  /**
   * Rank substitutes (default). False when re-hauling an estimate the
   * estimator already edited — their choices stand, only the haul updates.
   */
  rank?: boolean;
}

/** Distances the ranking and planning need, looked up once, in parallel. */
async function gatherDistances(args: LocalityArgs, job: LatLng) {
  const bySupplier = new Map<string, Distance | null>();
  const byTownText = new Map<string, Distance | null>();
  const bySource = new Map<string, Distance | null>();
  let anyRoad = false;

  const toDist = async (to: LatLng, basis: Distance["basis"], forceApprox = false): Promise<Distance> => {
    const d = await roadDistance(job, to);
    if (!d.approx) anyRoad = true;
    return { miles: d.miles, approx: d.approx || forceApprox, basis };
  };

  const located = args.suppliers.filter((s) => s.lat !== null && s.lng !== null);
  await mapLimit(located, 4, async (s) => {
    bySupplier.set(s.id, await settle(toDist({ lat: s.lat!, lng: s.lng! }, "supplier"), null, 9000));
  });

  // Legacy catalog rows with only a town in supplierLocation.
  const towns = [
    ...new Set(
      args.catalog
        .filter((m) => !m.supplierId && m.supplierLocation.trim())
        .map((m) => m.supplierLocation.trim())
    ),
  ];
  // One at a time: Nominatim asks for no more than a request a second.
  await mapLimit(towns, 1, async (t) => {
    const g = await settle(geocodePlace(t), null, 8000);
    byTownText.set(t, g ? await settle(toDist(g, "town", true), null, 9000) : null);
  });

  // Researched lines: "Menards – Iowa City, Hwy 1 W". A store the shop has on
  // file uses that location; anything else is looked up by name.
  const sourceSupplier = new Map<string, Supplier>();
  const sources = [...new Set(args.built.lines.filter((l) => !l.fromCatalog && l.source.trim()).map((l) => l.source.trim()))];
  await mapLimit(sources, 1, async (src) => {
    const known = matchSupplier(src, args.suppliers, job);
    if (known) {
      sourceSupplier.set(src, known);
      bySource.set(src, bySupplier.get(known.id) ?? null);
      return;
    }
    const g = await settle(geocodeStore(src, args.bias), null, 14000);
    bySource.set(src, g ? await settle(toDist(g, "supplier", true), null, 9000) : null);
  });

  let shopMiles: number | null = null;
  if (args.profile.shopLat !== null && args.profile.shopLng !== null) {
    const d = await settle(roadDistance({ lat: args.profile.shopLat, lng: args.profile.shopLng }, job), null, 9000);
    shopMiles = d ? d.miles : null;
  }

  return { bySupplier, byTownText, bySource, sourceSupplier, shopMiles, anyRoad };
}

function toAlternative(p: Priced): LineAlternative {
  return {
    materialId: p.materialId,
    material: p.name,
    supplier: p.supplierName,
    qty: fromMilli(p.qtyMilli),
    unit: p.unit,
    unitCost: fromCents(p.unitCostCents),
    materialCost: fromCents(p.materialCents),
    haul: fromCents(p.haulCents),
    landed: fromCents(p.landedCents),
    miles: p.distance?.miles ?? null,
    milesApprox: p.distance ? p.distance.approx || p.distance.basis !== "supplier" : true,
    source: p.supplierName || "Your catalog",
  };
}

export async function applyLocality(
  args: LocalityArgs
): Promise<{ built: BuiltEstimate; detail: HaulDetail }> {
  const warnings: string[] = [];
  const diesel = args.fuel.diesel;
  const trailersById = new Map((args.trailers ?? []).map((t) => [t.id, t]));
  const fleet = args.trucks.filter((t) => t.isActive).map((t) => toTruck(t, trailersById, args.fuel));

  // Machine fuel doesn't depend on distance; work it out up front.
  const machinesAll = (args.equipment ?? []).map(toMachine);
  const mf = machineFuel(args.machines ?? [], machinesAll, {
    diesel: diesel.centsPerGal,
    gas: args.fuel.gas.centsPerGal,
    offroad: args.fuel.offroad.centsPerGal,
  });
  const withMachines = (b: BuiltEstimate): BuiltEstimate => ({
    ...b,
    machineCents: mf.totalCents,
    machineLabel: machineLabel(mf.lines),
  });

  const baseDetail: HaulDetail = {
    diesel: { centsPerGal: diesel.centsPerGal, label: diesel.label, source: diesel.source },
    fuel: {
      gas: { centsPerGal: args.fuel.gas.centsPerGal, label: args.fuel.gas.label },
      offroad: { centsPerGal: args.fuel.offroad.centsPerGal, label: args.fuel.offroad.label },
    },
    machines: mf.lines,
    machineCents: mf.totalCents,
    trucksForJob: args.trucksForJob,
    shopMiles: null,
    distanceSource: "approx",
    plan: null,
    switched: [],
    warnings,
  };

  // Deposits don't depend on location; do them regardless.
  const withDeposits = (b: BuiltEstimate): BuiltEstimate => {
    const deposits = computeDeposits(b.lines, args.catalog);
    return { ...b, deposits, depositCents: deposits.reduce((a, d) => a + d.cents, 0) };
  };

  if (!args.job) {
    warnings.push("Couldn't find the job address on a map, so hauling wasn't computed from distance.");
    return { built: computeTotals(withMachines(withDeposits(args.built)), args.buildOpts), detail: baseDetail };
  }

  const suppliersById = new Map(args.suppliers.map((s) => [s.id, s]));
  const materialById = new Map(args.catalog.map((m) => [m.id, m]));
  const pool = args.catalog.filter((m) => m.isActive).map((m) => toCandidate(m, suppliersById));
  const dist = await gatherDistances(args, args.job);

  const distanceFor = (c: Candidate): Distance | null => {
    if (c.supplierId) return dist.bySupplier.get(c.supplierId) ?? null;
    const m = materialById.get(c.id);
    const town = m?.supplierLocation?.trim();
    return town ? dist.byTownText.get(town) ?? null : null;
  };

  const settings = {
    dieselCentsPerGal: diesel.centsPerGal,
    avgMph: args.profile.avgMph,
    loadMinutes: args.profile.loadMinutes,
    pickupStopMinutes: args.profile.pickupStopMinutes,
  };
  const dumpFleet = fleet
    .filter((t) => t.kind === "dump")
    .sort((a, b) => b.capacityTons - a.capacityTons)
    .slice(0, Math.max(1, args.trucksForJob));
  const pickupTruck =
    fleet.find((t) => t.kind === "pickup") ?? [...fleet].sort((a, b) => a.capacityTons - b.capacityTons)[0] ?? null;

  const visited = new Set<string>();
  const ctx: RankContext = {
    distanceFor,
    defaultMiles: args.profile.defaultHaulMiles,
    dumpTrucks: dumpFleet,
    pickupTruck,
    settings,
    visitedSuppliers: visited,
  };

  // Rank bulk lines first: they dominate haul cost, and a store they send us
  // to makes later pickups there free.
  const order = args.built.lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => Number(isBulk(b.l.unit)) - Number(isBulk(a.l.unit)));

  const lines: BuiltLine[] = [...args.built.lines];
  const switched: HaulDetail["switched"] = [];

  for (const { l, i } of args.rank === false ? [] : order) {
    if (!l.fromCatalog || !l.materialId) continue;
    const picked = pool.find((c) => c.id === l.materialId);
    if (!picked) continue;
    const r = rankSubstitutes(picked, l.qtyMilli, pool, ctx);
    const chosen = r.chosen;
    const chosenMat = materialById.get(chosen.materialId)!;

    const next: BuiltLine = {
      ...l,
      alternatives: r.alternatives.map(toAlternative),
      supplierId: chosen.supplierId,
      miles: chosen.distance?.miles ?? null,
      milesApprox: chosen.distance ? chosen.distance.approx || chosen.distance.basis !== "supplier" : true,
    };
    if (r.switched) {
      next.material = chosenMat.name;
      next.materialId = chosenMat.id;
      next.unit = chosenMat.unit;
      next.qtyMilli = chosen.qtyMilli;
      next.unitLowCents = chosenMat.unitCostCents;
      next.unitHighCents = chosenMat.unitCostCents;
      next.source = chosen.supplierName || "Your catalog";
      next.replaced = l.material;
      next.savedCents = r.savedCents;
      next.basis = `${l.basis ? l.basis + " — " : ""}substituted for ${l.material}: $${(r.savedCents / 100).toFixed(2)} cheaper delivered`;
      switched.push({ from: l.material, to: chosenMat.name, savedCents: r.savedCents });
    } else {
      const s = chosen.supplierId ? suppliersById.get(chosen.supplierId) : undefined;
      if (s) next.source = s.name;
    }
    if (haulModeFor({ haul: chosenMat.haul, unit: chosenMat.unit }) === "pickup" && chosen.supplierId) {
      visited.add(chosen.supplierId);
    }
    lines[i] = next;
  }

  // ── haul plan ──
  if (fleet.length === 0) {
    warnings.push("No trucks set up yet — hauling uses the AI's delivery guess. Add your trucks in Settings.");
    const b = computeTotals(withMachines(withDeposits({ ...args.built, lines })), args.buildOpts);
    return {
      built: b,
      detail: { ...baseDetail, shopMiles: dist.shopMiles, distanceSource: dist.anyRoad ? "road" : "approx", switched },
    };
  }

  let assumedCount = 0;
  const haulLines: HaulLine[] = lines.map((l, i) => {
    const key = String(i);
    const m = l.fromCatalog && l.materialId ? materialById.get(l.materialId) : undefined;
    if (m) {
      const c = toCandidate(m, suppliersById);
      const mode = haulModeFor(c);
      const d = distanceFor(c);
      const bl = bulkLoad(l.qtyMilli, l.unit, c);
      if (!d && (mode === "dump" || mode === "pickup")) assumedCount++;
      return {
        key,
        material: l.material,
        mode,
        tons: bl?.tons,
        cuYd: bl?.cuYd,
        supplierKey: c.supplierId ?? `name:${(c.supplierName || m.supplierLocation || m.name).toLowerCase()}`,
        supplierName: c.supplierName || m.supplierLocation || "catalog supplier",
        oneWayMiles: d ? d.miles : args.profile.defaultHaulMiles,
        milesApprox: d ? d.approx || d.basis !== "supplier" : true,
        deliveryFeeCents: c.deliveryFeeCents,
      };
    }
    const d = dist.bySource.get(l.source.trim()) ?? null;
    const known = dist.sourceSupplier.get(l.source.trim());
    const bl = bulkLoad(l.qtyMilli, l.unit, { name: l.material, unit: l.unit });
    if (!d) assumedCount++;
    if (known) lines[i] = { ...lines[i], source: known.name };
    return {
      key,
      material: l.material,
      mode: isBulk(l.unit) ? "dump" : "pickup",
      tons: bl?.tons,
      cuYd: bl?.cuYd,
      // Same key as catalog lines from that store, so it's one stop, not two.
      supplierKey: known ? known.id : `src:${l.source.trim().toLowerCase()}`,
      supplierName: known ? known.name : l.source.trim() || l.material,
      oneWayMiles: d ? d.miles : args.profile.defaultHaulMiles,
      milesApprox: known && d ? d.approx : true,
    };
  });

  // Machines that ride a trailer out: pulled by the truck that has that
  // trailer hitched, if any, otherwise the job's lead truck.
  const mobs: Mobilization[] = mf.lines
    .map((l) => machinesAll.find((m) => m.id === l.equipmentId)!)
    .filter((m) => m && m.haulTrips > 0)
    .map((m) => ({
      key: m.id,
      name: m.name,
      trips: m.haulTrips,
      truckId: args.trucks.find((t) => t.isActive && t.trailerId && t.trailerId === m.trailerId)?.id ?? null,
    }));

  const plan = planHaul(
    haulLines,
    fleet,
    {
      ...settings,
      trucksForJob: args.trucksForJob,
      shopMiles: dist.shopMiles,
    },
    mobs
  );
  warnings.push(...plan.warnings);

  if (assumedCount > 0) {
    warnings.push(
      `${assumedCount} line${assumedCount === 1 ? "" : "s"} had no supplier location — assumed ${args.profile.defaultHaulMiles} mi each way. Add the supplier's address to fix.`
    );
  }

  plan.lines.forEach((pl) => {
    const i = Number(pl.key);
    lines[i] = { ...lines[i], haulCents: pl.haulCents, miles: pl.oneWayMiles, milesApprox: pl.milesApprox };
  });

  const loads = plan.totalLoads;
  const stops = plan.pickupStops.length;
  const machineTrips = plan.mobilization.reduce((a, m) => a + m.trips, 0);
  const labelParts = [
    loads ? `${loads} load${loads === 1 ? "" : "s"}` : "",
    stops ? `${stops} store run${stops === 1 ? "" : "s"}` : "",
    machineTrips ? `${machineTrips} machine trip${machineTrips === 1 ? "" : "s"}` : "",
    plan.commute.trucks ? `${plan.commute.trucks} truck${plan.commute.trucks === 1 ? "" : "s"}` : "",
    `${Math.round(plan.totalMiles)} mi${dist.anyRoad ? "" : " (approx)"}`,
    `diesel $${(diesel.centsPerGal / 100).toFixed(2)}`,
  ].filter(Boolean);

  const withHaul: BuiltEstimate = {
    ...args.built,
    lines,
    deliveryLowCents: plan.totalCents,
    deliveryHighCents: plan.totalCents,
    haulSource: plan.totalCents > 0 ? "computed" : "none",
    haulLabel: labelParts.join(" · "),
  };

  const built = computeTotals(withMachines(withDeposits(withHaul)), args.buildOpts);

  return {
    built,
    detail: {
      ...baseDetail,
      shopMiles: dist.shopMiles,
      distanceSource: dist.anyRoad ? "road" : "approx",
      switched,
      warnings: [...new Set(warnings)],
      plan: {
        totalCents: plan.totalCents,
        totalMiles: plan.totalMiles,
        totalHours: plan.totalHours,
        totalLoads: plan.totalLoads,
        trucksUsed: plan.trucksUsed.map((t) => ({ name: t.name, loads: t.loads })),
        commute: plan.commute,
        pickupStops: plan.pickupStops.map((p) => ({
          supplier: p.supplierName,
          miles: p.miles,
          cents: p.cents,
          lines: p.lineKeys.length,
        })),
        mobilization: plan.mobilization.map((m) => ({
          name: m.name,
          truckName: m.truckName,
          trips: m.trips,
          miles: m.miles,
          cents: m.cents,
        })),
        lines: plan.lines.map((pl) => ({
          material: pl.material,
          mode: pl.mode,
          loads: pl.loads.length,
          miles: pl.miles,
          haulCents: pl.haulCents,
          oneWayMiles: pl.oneWayMiles,
          approx: pl.milesApprox,
        })),
      },
    },
  };
}

function isBulk(unit: string): boolean {
  return unit === "ton" || unit === "cu yd";
}
