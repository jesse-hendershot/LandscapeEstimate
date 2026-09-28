/**
 * Trailers, owner-scoped: data access, wire shape and validation in one place.
 *
 * Tons and cubic yards on the wire, thousandths in the database — the same
 * convention as trucks.
 */

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { equipment, trailers, trucks, type NewTrailerRow, type TrailerRow } from "../db/schema";

export const TRAILER_KINDS = ["dump", "equipment", "utility"] as const;

export function presentTrailer(t: TrailerRow) {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind as (typeof TRAILER_KINDS)[number],
    capacityTons: t.capacityTonsMilli / 1000,
    capacityCuYd: t.capacityCuYdMilli / 1000,
  };
}

export type TrailerDto = ReturnType<typeof presentTrailer>;

export const trailerSchema = z.object({
  name: z.string().trim().min(1, "give it a name").max(80),
  kind: z.enum(TRAILER_KINDS),
  capacityTons: z.number().min(0).max(40),
  capacityCuYd: z.number().min(0).max(40),
});

export function trailerRowFrom(input: Partial<z.infer<typeof trailerSchema>>) {
  const row: Partial<NewTrailerRow> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.kind !== undefined) row.kind = input.kind;
  if (input.capacityTons !== undefined) row.capacityTonsMilli = Math.round(input.capacityTons * 1000);
  if (input.capacityCuYd !== undefined) row.capacityCuYdMilli = Math.round(input.capacityCuYd * 1000);
  return row;
}

export async function listTrailers(ownerId: string): Promise<TrailerRow[]> {
  return db
    .select()
    .from(trailers)
    .where(and(eq(trailers.ownerId, ownerId), eq(trailers.isActive, true)))
    .orderBy(asc(trailers.createdAt));
}

export async function createTrailer(ownerId: string, input: z.infer<typeof trailerSchema>): Promise<TrailerRow> {
  const [row] = await db
    .insert(trailers)
    .values({ ...(trailerRowFrom(input) as Omit<NewTrailerRow, "ownerId">), ownerId })
    .returning();
  return row;
}

export async function updateTrailer(
  ownerId: string,
  id: string,
  input: Partial<z.infer<typeof trailerSchema>>
): Promise<TrailerRow | null> {
  const [row] = await db
    .update(trailers)
    .set({ ...trailerRowFrom(input), updatedAt: new Date() })
    .where(and(eq(trailers.ownerId, ownerId), eq(trailers.id, id)))
    .returning();
  return row ?? null;
}

/**
 * Soft delete, and unhitch it from any truck or machine so nothing keeps
 * planning around a trailer the shop says it no longer has.
 */
export async function removeTrailer(ownerId: string, id: string): Promise<boolean> {
  const [row] = await db
    .update(trailers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(trailers.ownerId, ownerId), eq(trailers.id, id)))
    .returning({ id: trailers.id });
  if (!row) return false;
  await db
    .update(trucks)
    .set({ trailerId: null, updatedAt: new Date() })
    .where(and(eq(trucks.ownerId, ownerId), eq(trucks.trailerId, id)));
  await db
    .update(equipment)
    .set({ trailerId: null, updatedAt: new Date() })
    .where(and(eq(equipment.ownerId, ownerId), eq(equipment.trailerId, id)));
  return true;
}

/** True when the trailer exists, is active and belongs to this account. */
export async function ownsTrailer(ownerId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: trailers.id })
    .from(trailers)
    .where(and(eq(trailers.ownerId, ownerId), eq(trailers.id, id), eq(trailers.isActive, true)))
    .limit(1);
  return Boolean(row);
}
