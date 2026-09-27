/**
 * Fleet data access, owner-scoped.
 *
 * A new account gets two placeholder trucks so hauling shows up on the very
 * first estimate. They're named "(edit me)" on purpose: the haul breakdown
 * shows truck names, so a shop that hasn't entered its real trucks sees that
 * on every estimate until it does.
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";
import { trucks, type NewTruckRow, type TruckRow } from "../db/schema";

export const DEFAULT_TRUCKS: Omit<NewTruckRow, "ownerId">[] = [
  {
    name: "Tandem dump (edit me)",
    kind: "dump",
    capacityTonsMilli: 14_000,
    capacityCuYdMilli: 12_000,
    mpgTenths: 60,
    costPerHourCents: 7500,
  },
  {
    name: "Pickup + trailer (edit me)",
    kind: "pickup",
    capacityTonsMilli: 2_000,
    capacityCuYdMilli: 2_000,
    mpgTenths: 140,
    costPerHourCents: 4500,
  },
];

export async function listTrucks(ownerId: string, opts: { includeInactive?: boolean } = {}): Promise<TruckRow[]> {
  const where = opts.includeInactive
    ? eq(trucks.ownerId, ownerId)
    : and(eq(trucks.ownerId, ownerId), eq(trucks.isActive, true));
  return db.select().from(trucks).where(where).orderBy(asc(trucks.createdAt));
}

/** Idempotent: does nothing for an account that has ever had a truck. */
export async function seedTrucksIfEmpty(ownerId: string): Promise<number> {
  const existing = await db.select({ id: trucks.id }).from(trucks).where(eq(trucks.ownerId, ownerId)).limit(1);
  if (existing.length > 0) return 0;
  const rows = await db
    .insert(trucks)
    .values(DEFAULT_TRUCKS.map((t) => ({ ...t, ownerId })))
    .returning({ id: trucks.id });
  return rows.length;
}

export async function createTruck(ownerId: string, input: Omit<NewTruckRow, "ownerId" | "id">): Promise<TruckRow> {
  const [row] = await db.insert(trucks).values({ ...input, ownerId }).returning();
  return row;
}

export async function updateTruck(
  ownerId: string,
  id: string,
  patch: Partial<Omit<NewTruckRow, "ownerId" | "id">>
): Promise<TruckRow | null> {
  const [row] = await db
    .update(trucks)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(trucks.ownerId, ownerId), eq(trucks.id, id)))
    .returning();
  return row ?? null;
}

/** Soft delete, so a removed truck isn't re-seeded as a default. */
export async function removeTruck(ownerId: string, id: string): Promise<boolean> {
  const [row] = await db
    .update(trucks)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(trucks.ownerId, ownerId), eq(trucks.id, id)))
    .returning({ id: trucks.id });
  return Boolean(row);
}
