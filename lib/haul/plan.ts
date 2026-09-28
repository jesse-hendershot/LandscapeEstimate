/**
 * The haul planner: what it costs to get the material onto the job.
 *
 * This is the locality engine's arithmetic. It is pure — no network, no
 * database — so every rule below is tested directly.
 *
 * How a job is modelled, per the shop's own description of how they work:
 *
 *   1. Everything is measured FROM THE JOB SITE. A load of rock is a round
 *      trip job -> supplier -> job. So is a run to Menards for fabric.
 *   2. Each truck on the job also drives shop -> job at the start of the day
 *      and job -> shop at the end. That's added once per truck, at the end.
 *   3. The number of trucks matters. More trucks finish sooner but each one
 *      adds its own shop round trip. Bulk loads are shared round-robin across
 *      the trucks on the job, biggest truck first.
 *
 * A trip costs fuel (miles / mpg x that truck's fuel price — diesel, or gas for
 * a gas pickup) plus time (hours x the truck's hourly cost, which covers the
 * driver and wear but NOT fuel — fuel is counted separately so a diesel spike
 * shows up in every estimate the week it happens).
 *
 * Machines that ride out on a trailer add their own shop round trips.
 *
 * Money comes out in integer cents. Distances and hours are floats; they are
 * inputs to a cost, not numbers a contractor bills, and each cost is rounded to
 * the cent exactly once.
 */

export type HaulMode = "dump" | "pickup" | "delivered" | "none";

export interface Truck {
  id: string;
  name: string;
  kind: "dump" | "pickup";
  capacityTons: number;
  capacityCuYd: number;
  mpg: number;
  /** Driver + truck per hour, excluding fuel. */
  costPerHourCents: number;
  /** This truck's fuel price (gas or diesel). Falls back to the settings' diesel. */
  fuelCentsPerGal?: number;
}

/** A machine hauled out to the job and back on a trailer. */
export interface Mobilization {
  key: string;
  name: string;
  /** Round trips shop <-> job. */
  trips: number;
  /** The truck that pulls its trailer, when one is set up for it. */
  truckId?: string | null;
}

export interface MobilizationResult {
  key: string;
  name: string;
  truckName: string;
  trips: number;
  miles: number;
  hours: number;
  cents: number;
}

export interface HaulSettings {
  dieselCentsPerGal: number;
  /** Average road speed of a working truck, mph. */
  avgMph: number;
  /** Minutes per bulk load spent at the scale, loading and dumping. */
  loadMinutes: number;
  /** Minutes spent inside a store per pickup stop. */
  pickupStopMinutes: number;
  /** How many dump trucks run this job. Clamped to the fleet. */
  trucksForJob: number;
  /** One-way road miles shop -> job, or null when the shop isn't located. */
  shopMiles: number | null;
}

export interface HaulLine {
  key: string;
  material: string;
  mode: HaulMode;
  /** Bulk quantity, required for "dump". */
  tons?: number;
  cuYd?: number;
  /** Groups pickup stops; one trip per distinct supplier. */
  supplierKey: string | null;
  supplierName?: string;
  /** One-way road miles job -> supplier. Null = unknown. */
  oneWayMiles: number | null;
  milesApprox?: boolean;
  /** Supplier's flat delivery fee, for mode "delivered". */
  deliveryFeeCents?: number;
}

export interface LoadDetail {
  truckId: string;
  truckName: string;
  tons: number;
}

export interface HaulLineResult {
  key: string;
  material: string;
  mode: HaulMode;
  loads: LoadDetail[];
  miles: number;
  hours: number;
  fuelCents: number;
  timeCents: number;
  feeCents: number;
  /** fuel + time + fee attributable to this line. */
  haulCents: number;
  oneWayMiles: number | null;
  milesApprox: boolean;
}

export interface PickupStop {
  supplierKey: string;
  supplierName: string;
  truckName: string;
  oneWayMiles: number;
  miles: number;
  hours: number;
  cents: number;
  lineKeys: string[];
}

export interface HaulPlan {
  lines: HaulLineResult[];
  pickupStops: PickupStop[];
  /** Machines hauled out and back. Their trips start and end at the shop. */
  mobilization: MobilizationResult[];
  commute: { trucks: number; milesEach: number; miles: number; hours: number; cents: number };
  trucksUsed: { id: string; name: string; loads: number }[];
  totalCents: number;
  totalMiles: number;
  totalHours: number;
  totalLoads: number;
  warnings: string[];
}

export function fuelCents(miles: number, mpg: number, centsPerGal: number): number {
  if (miles <= 0 || mpg <= 0) return 0;
  return Math.round((miles / mpg) * centsPerGal);
}

/** The price a truck's miles are costed at: its own fuel, else diesel. */
export function priceOf(t: Truck, s: Pick<HaulSettings, "dieselCentsPerGal">): number {
  return t.fuelCentsPerGal !== undefined && t.fuelCentsPerGal > 0 ? t.fuelCentsPerGal : s.dieselCentsPerGal;
}

export function timeCents(hours: number, costPerHourCents: number): number {
  if (hours <= 0 || costPerHourCents <= 0) return 0;
  return Math.round(hours * costPerHourCents);
}

/** Tons one load of this truck can carry of a material with the given density. */
export function tonsPerLoad(t: Truck, tonsPerCuYd: number): number {
  const byWeight = t.capacityTons > 0 ? t.capacityTons : Infinity;
  const byVolume = t.capacityCuYd > 0 && tonsPerCuYd > 0 ? t.capacityCuYd * tonsPerCuYd : Infinity;
  const cap = Math.min(byWeight, byVolume);
  return Number.isFinite(cap) ? cap : 0;
}

/**
 * Split a bulk quantity into loads across the trucks on the job.
 *
 * Round-robin from the biggest truck, each load carrying as much as that truck
 * can. A 1.5% tolerance stops 14.1 tons in a 14-ton truck from becoming a
 * second trip for a hundred pounds — nobody sends a truck back for that.
 */
export function splitLoads(tons: number, cuYd: number, trucks: Truck[]): LoadDetail[] {
  if (tons <= 0 || trucks.length === 0) return [];
  const density = cuYd > 0 ? tons / cuYd : 1.3;
  const order = [...trucks].sort((a, b) => tonsPerLoad(b, density) - tonsPerLoad(a, density));
  const caps = order.map((t) => tonsPerLoad(t, density));
  if (caps.every((c) => c <= 0)) return [];

  const loads: LoadDetail[] = [];
  let remaining = tons;
  let i = 0;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 1000) {
    const cap = caps[i % order.length];
    if (cap > 0) {
      const tolerance = cap * 0.015;
      const take = remaining <= cap + tolerance ? remaining : cap;
      loads.push({ truckId: order[i % order.length].id, truckName: order[i % order.length].name, tons: take });
      remaining -= take;
    }
    i++;
  }
  return loads;
}

/**
 * Plan the haul for a whole estimate.
 *
 * `fleet` is every active truck on the account. Dump work uses the
 * `trucksForJob` biggest dump trucks; pickup stops use the first pickup (or the
 * smallest dump truck if the shop has no pickup listed).
 */
export function planHaul(lines: HaulLine[], fleet: Truck[], s: HaulSettings, mobs: Mobilization[] = []): HaulPlan {
  const warnings: string[] = [];
  const mph = s.avgMph > 0 ? s.avgMph : 35;

  const dumpFleet = fleet
    .filter((t) => t.kind === "dump")
    .sort((a, b) => b.capacityTons - a.capacityTons);
  const jobTrucks = dumpFleet.slice(0, Math.max(1, Math.min(s.trucksForJob || 1, dumpFleet.length)));
  const pickupTruck =
    fleet.find((t) => t.kind === "pickup") ?? [...dumpFleet].sort((a, b) => a.capacityTons - b.capacityTons)[0];

  const results: HaulLineResult[] = [];
  const loadsPerTruck = new Map<string, number>();
  const stopsBySupplier = new Map<string, { line: HaulLine; keys: string[] }>();

  for (const line of lines) {
    const base: HaulLineResult = {
      key: line.key,
      material: line.material,
      mode: line.mode,
      loads: [],
      miles: 0,
      hours: 0,
      fuelCents: 0,
      timeCents: 0,
      feeCents: 0,
      haulCents: 0,
      oneWayMiles: line.oneWayMiles,
      milesApprox: Boolean(line.milesApprox),
    };

    if (line.mode === "none") {
      results.push(base);
      continue;
    }

    if (line.mode === "delivered") {
      base.feeCents = Math.max(0, Math.round(line.deliveryFeeCents ?? 0));
      base.haulCents = base.feeCents;
      results.push(base);
      continue;
    }

    if (line.oneWayMiles === null || !Number.isFinite(line.oneWayMiles)) {
      warnings.push(`No location for the supplier of "${line.material}" — its haul isn't counted.`);
      results.push(base);
      continue;
    }

    if (line.mode === "pickup") {
      const key = line.supplierKey ?? `line:${line.key}`;
      const existing = stopsBySupplier.get(key);
      if (existing) existing.keys.push(line.key);
      else stopsBySupplier.set(key, { line, keys: [line.key] });
      results.push(base); // cost attached after stops are grouped
      continue;
    }

    // ── dump ──
    if (jobTrucks.length === 0) {
      warnings.push(`No dump truck set up — "${line.material}" haul isn't counted. Add your trucks in Settings.`);
      results.push(base);
      continue;
    }

    const tons = line.tons ?? 0;
    const cuYd = line.cuYd ?? 0;
    const loads = splitLoads(tons, cuYd, jobTrucks);
    const roundTrip = 2 * line.oneWayMiles;

    for (const ld of loads) {
      const truck = jobTrucks.find((t) => t.id === ld.truckId)!;
      const hours = roundTrip / mph + s.loadMinutes / 60;
      base.miles += roundTrip;
      base.hours += hours;
      base.fuelCents += fuelCents(roundTrip, truck.mpg, priceOf(truck, s));
      base.timeCents += timeCents(hours, truck.costPerHourCents);
      loadsPerTruck.set(truck.id, (loadsPerTruck.get(truck.id) ?? 0) + 1);
    }
    base.loads = loads;
    base.haulCents = base.fuelCents + base.timeCents;
    results.push(base);
  }

  // ── pickup stops: one round trip per distinct supplier ──
  const pickupStops: PickupStop[] = [];
  if (stopsBySupplier.size > 0 && !pickupTruck) {
    warnings.push("No truck set up for store runs — pickup trips aren't counted. Add a truck in Settings.");
  }
  if (pickupTruck) {
    for (const [supplierKey, { line, keys }] of stopsBySupplier) {
      const oneWay = line.oneWayMiles ?? 0;
      const miles = 2 * oneWay;
      const hours = miles / mph + s.pickupStopMinutes / 60;
      const cents =
        fuelCents(miles, pickupTruck.mpg, priceOf(pickupTruck, s)) +
        timeCents(hours, pickupTruck.costPerHourCents);
      pickupStops.push({
        supplierKey,
        supplierName: line.supplierName ?? line.material,
        truckName: pickupTruck.name,
        oneWayMiles: oneWay,
        miles,
        hours,
        cents,
        lineKeys: keys,
      });

      // Split the stop across its lines so per-line haul still sums to the
      // total. Remainder cents go to the first line so nothing is lost.
      const share = Math.floor(cents / keys.length);
      const rem = cents - share * keys.length;
      keys.forEach((k, idx) => {
        const r = results.find((x) => x.key === k)!;
        r.miles = miles / keys.length;
        r.hours = hours / keys.length;
        // Fuel/time stay on the stop itself; the line carries only its share.
        r.haulCents = share + (idx === 0 ? rem : 0);
      });
    }
    if (pickupStops.length > 0) {
      loadsPerTruck.set(pickupTruck.id, (loadsPerTruck.get(pickupTruck.id) ?? 0) + pickupStops.length);
    }
  }

  // ── shop <-> job, once per truck that turns a wheel on this job ──
  const usedIds = [...loadsPerTruck.keys()];
  const used = usedIds
    .map((id) => fleet.find((t) => t.id === id))
    .filter((t): t is Truck => Boolean(t));

  let commute = { trucks: used.length, milesEach: 0, miles: 0, hours: 0, cents: 0 };
  if (used.length > 0) {
    if (s.shopMiles === null || !Number.isFinite(s.shopMiles)) {
      warnings.push("Shop address isn't set — miles to and from the shop aren't counted.");
    } else {
      const milesEach = 2 * s.shopMiles;
      let cents = 0;
      let hours = 0;
      for (const t of used) {
        const h = milesEach / mph;
        hours += h;
        cents += fuelCents(milesEach, t.mpg, priceOf(t, s)) + timeCents(h, t.costPerHourCents);
      }
      commute = { trucks: used.length, milesEach, miles: milesEach * used.length, hours, cents };
    }
  }

  // ── machines out and back: each trip is shop -> job -> shop with the trailer ──
  const mobilization: MobilizationResult[] = [];
  for (const m of mobs) {
    const trips = Math.max(0, Math.round(m.trips));
    if (trips === 0) continue;
    const truck = (m.truckId && fleet.find((t) => t.id === m.truckId)) || jobTrucks[0] || fleet[0];
    if (!truck) {
      warnings.push(`No truck set up to haul the ${m.name} — its trips aren't counted.`);
      continue;
    }
    if (s.shopMiles === null || !Number.isFinite(s.shopMiles)) {
      warnings.push("Shop address isn't set — trips hauling machines out aren't counted.");
      continue;
    }
    const miles = trips * 2 * s.shopMiles;
    // Driving, plus loading and strapping down at each end of each trip.
    const hours = miles / mph + (trips * s.loadMinutes) / 60;
    const cents = fuelCents(miles, truck.mpg, priceOf(truck, s)) + timeCents(hours, truck.costPerHourCents);
    mobilization.push({ key: m.key, name: m.name, truckName: truck.name, trips, miles, hours, cents });
  }
  const mobCents = mobilization.reduce((a, m) => a + m.cents, 0);

  const lineCents = results.reduce((a, r) => a + r.haulCents, 0);
  const totalCents = lineCents + commute.cents + mobCents;
  const totalMiles = results.reduce((a, r) => a + r.miles, 0) + commute.miles + mobilization.reduce((a, m) => a + m.miles, 0);
  const totalHours = results.reduce((a, r) => a + r.hours, 0) + commute.hours + mobilization.reduce((a, m) => a + m.hours, 0);

  return {
    lines: results,
    pickupStops,
    mobilization,
    commute,
    trucksUsed: used.map((t) => ({ id: t.id, name: t.name, loads: loadsPerTruck.get(t.id) ?? 0 })),
    totalCents,
    totalMiles,
    totalHours,
    totalLoads: results.reduce((a, r) => a + r.loads.length, 0),
    warnings: [...new Set(warnings)],
  };
}

/**
 * Haul cost of ONE bulk line from one supplier, ignoring the shop commute.
 *
 * This is the marginal cost used to rank substitutes: the shop round trip is
 * the same whichever quarry the rock comes from, so it can't change the
 * answer and is left out.
 */
export function bulkLineHaulCents(
  tons: number,
  cuYd: number,
  oneWayMiles: number,
  trucks: Truck[],
  s: Pick<HaulSettings, "dieselCentsPerGal" | "avgMph" | "loadMinutes">
): { cents: number; loads: number } {
  const mph = s.avgMph > 0 ? s.avgMph : 35;
  const loads = splitLoads(tons, cuYd, trucks);
  let cents = 0;
  for (const ld of loads) {
    const t = trucks.find((x) => x.id === ld.truckId)!;
    const miles = 2 * oneWayMiles;
    const hours = miles / mph + s.loadMinutes / 60;
    cents += fuelCents(miles, t.mpg, priceOf(t, s)) + timeCents(hours, t.costPerHourCents);
  }
  return { cents, loads: loads.length };
}

/** Cost of one pickup round trip to a supplier. */
export function pickupTripCents(
  oneWayMiles: number,
  truck: Truck,
  s: Pick<HaulSettings, "dieselCentsPerGal" | "avgMph" | "pickupStopMinutes">
): number {
  const mph = s.avgMph > 0 ? s.avgMph : 35;
  const miles = 2 * oneWayMiles;
  const hours = miles / mph + s.pickupStopMinutes / 60;
  return fuelCents(miles, truck.mpg, priceOf(truck, s)) + timeCents(hours, truck.costPerHourCents);
}
