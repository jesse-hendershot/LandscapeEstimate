import { z } from "zod";

import type { TruckRow } from "../db/schema";

/** Thousandths and cents in the database; tons, mpg and dollars on the wire. */
export function presentTruck(t: TruckRow) {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind as "dump" | "pickup",
    capacityTons: t.capacityTonsMilli / 1000,
    capacityCuYd: t.capacityCuYdMilli / 1000,
    mpg: t.mpgTenths / 10,
    costPerHour: t.costPerHourCents / 100,
    isActive: t.isActive,
  };
}

export type TruckDto = ReturnType<typeof presentTruck>;

export const truckSchema = z.object({
  name: z.string().trim().min(1, "give it a name").max(80),
  kind: z.enum(["dump", "pickup"]),
  capacityTons: z.number().min(0.1, "capacity must be above zero").max(40),
  capacityCuYd: z.number().min(0.1, "capacity must be above zero").max(40),
  mpg: z.number().min(1, "mpg must be at least 1").max(40),
  costPerHour: z.number().min(0).max(500),
});

export function truckRowFrom(input: Partial<z.infer<typeof truckSchema>>) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.kind !== undefined) row.kind = input.kind;
  if (input.capacityTons !== undefined) row.capacityTonsMilli = Math.round(input.capacityTons * 1000);
  if (input.capacityCuYd !== undefined) row.capacityCuYdMilli = Math.round(input.capacityCuYd * 1000);
  if (input.mpg !== undefined) row.mpgTenths = Math.round(input.mpg * 10);
  if (input.costPerHour !== undefined) row.costPerHourCents = Math.round(input.costPerHour * 100);
  return row;
}
