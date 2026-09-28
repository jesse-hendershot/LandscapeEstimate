/**
 * Machine fuel: what the skid steer, mini excavator or tractor burns on site.
 *
 * Engine hours come from the model (it reads the job: feet of trench, yards
 * moved, square feet graded) and the estimator can change them on the
 * estimate. Gallons per hour and the fuel come from the machine as the shop
 * entered it in Settings. The price is this week's for that fuel — for most
 * machines that's dyed off-road diesel.
 *
 *   cost = hours x gal/hr x $/gal, rounded to the cent once.
 *
 * Pure. The trips to haul a machine out are hauling, and live in the planner.
 */

import type { FuelKind } from "./fuel";

export interface Machine {
  id: string;
  name: string;
  kind: string;
  fuel: FuelKind;
  galPerHour: number;
  trailerId: string | null;
  haulTrips: number;
}

/** One machine's hours on one job. */
export interface MachineUse {
  equipmentId: string;
  hours: number;
  basis?: string;
}

export interface MachineLine {
  equipmentId: string;
  name: string;
  hours: number;
  basis: string;
  galPerHour: number;
  gallons: number;
  fuel: FuelKind;
  centsPerGal: number;
  cents: number;
}

export const MAX_HOURS = 200;

/** Hours to the nearest quarter, clamped to something a job could take. */
export function roundHours(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.min(MAX_HOURS, Math.round(h * 4) / 4);
}

/**
 * Clean up machine hours from the model or the browser: known machines only,
 * one entry per machine (hours added), quarter-hour rounding, zero dropped.
 */
export function normalizeUses(raw: unknown, machines: Pick<Machine, "id">[]): { uses: MachineUse[]; unknown: number } {
  const known = new Set(machines.map((m) => m.id));
  const byId = new Map<string, MachineUse>();
  let unknown = 0;
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = r as Record<string, unknown>;
    const id = typeof o?.equipmentId === "string" ? o.equipmentId.trim() : "";
    const h = Number(o?.hours);
    const hours = Number.isFinite(h) && h > 0 ? h : 0;
    if (!id || !known.has(id)) {
      if (id || hours > 0) unknown++;
      continue;
    }
    const basis = typeof o.basis === "string" ? o.basis.trim().slice(0, 400) : "";
    const prev = byId.get(id);
    if (prev) {
      prev.hours += hours;
      if (basis) prev.basis = prev.basis ? `${prev.basis}; ${basis}` : basis;
    } else {
      byId.set(id, { equipmentId: id, hours, basis });
    }
  }
  // Round once, after merging, so two 0.6 hr entries make 1.25, not 1.
  const uses = [...byId.values()].map((u) => ({ ...u, hours: roundHours(u.hours) })).filter((u) => u.hours > 0);
  return { uses, unknown };
}

export function machineFuel(
  uses: MachineUse[],
  machines: Machine[],
  priceCents: Record<FuelKind, number>
): { lines: MachineLine[]; totalCents: number } {
  const byId = new Map(machines.map((m) => [m.id, m]));
  const lines: MachineLine[] = [];
  for (const u of uses) {
    const m = byId.get(u.equipmentId);
    if (!m || u.hours <= 0) continue;
    const gallons = u.hours * Math.max(0, m.galPerHour);
    const centsPerGal = priceCents[m.fuel] ?? priceCents.diesel;
    lines.push({
      equipmentId: m.id,
      name: m.name,
      hours: u.hours,
      basis: u.basis ?? "",
      galPerHour: m.galPerHour,
      gallons,
      fuel: m.fuel,
      centsPerGal,
      cents: Math.round(gallons * centsPerGal),
    });
  }
  return { lines, totalCents: lines.reduce((a, l) => a + l.cents, 0) };
}

export const FUEL_WORD: Record<FuelKind, string> = { offroad: "off-road diesel", diesel: "diesel", gas: "gas" };

/** "Skid steer 6 hr, Mini ex 2.5 hr · off-road diesel $6.11" */
export function machineLabel(lines: MachineLine[]): string {
  if (lines.length === 0) return "";
  const parts = lines.map((l) => `${l.name} ${l.hours} hr`);
  const fuels = [...new Set(lines.map((l) => `${FUEL_WORD[l.fuel]} $${(l.centsPerGal / 100).toFixed(2)}`))];
  return `${parts.join(", ")} · ${fuels.join(", ")}`;
}
