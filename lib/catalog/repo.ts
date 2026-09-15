/**
 * Catalog data access.
 *
 * Every function here takes an `ownerId` as its first argument and puts it in
 * the WHERE clause. That is the isolation boundary — there is deliberately no
 * function that reads a material by id alone, because such a function is one
 * careless call site away from serving another shop's pricing.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { materials, type Material, type NewMaterial } from "../db/schema";
import { seedRowsFor } from "./seed";

export async function listMaterials(
  ownerId: string,
  opts: { includeInactive?: boolean } = {}
): Promise<Material[]> {
  const where = opts.includeInactive
    ? eq(materials.ownerId, ownerId)
    : and(eq(materials.ownerId, ownerId), eq(materials.isActive, true));

  return db
    .select()
    .from(materials)
    .where(where)
    // Most-used first: that ordering is what "personalized common materials"
    // actually means once the account has history.
    .orderBy(desc(materials.useCount), asc(materials.name));
}

export async function getMaterial(ownerId: string, id: string): Promise<Material | null> {
  const rows = await db
    .select()
    .from(materials)
    .where(and(eq(materials.ownerId, ownerId), eq(materials.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createMaterial(
  ownerId: string,
  input: Omit<NewMaterial, "ownerId" | "id">
): Promise<Material> {
  const [row] = await db
    .insert(materials)
    .values({ ...input, ownerId })
    .returning();
  return row;
}

export async function updateMaterial(
  ownerId: string,
  id: string,
  patch: Partial<Omit<NewMaterial, "ownerId" | "id">>
): Promise<Material | null> {
  const next: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  // A price change stamps its own timestamp so you can see at a glance which
  // catalog entries have gone stale.
  if (patch.unitCostCents !== undefined) next.priceUpdatedAt = new Date();

  const [row] = await db
    .update(materials)
    .set(next)
    .where(and(eq(materials.ownerId, ownerId), eq(materials.id, id)))
    .returning();
  return row ?? null;
}

/**
 * Soft delete. A material referenced by past estimates must not vanish — the
 * estimate would lose the provenance of its own line.
 */
export async function deactivateMaterial(ownerId: string, id: string): Promise<boolean> {
  const [row] = await db
    .update(materials)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(materials.ownerId, ownerId), eq(materials.id, id)))
    .returning();
  return Boolean(row);
}

/** Bump use counts for the materials that landed on an estimate. */
export async function recordUsage(ownerId: string, materialIds: string[]): Promise<void> {
  const unique = [...new Set(materialIds.filter(Boolean))];
  if (unique.length === 0) return;

  // inArray parameterizes the list. Never interpolate ids into SQL text here —
  // they arrive from a request body, and a uuid column will happily accept a
  // cast expression that was never a uuid.
  await db
    .update(materials)
    .set({ useCount: sql`${materials.useCount} + 1` })
    .where(and(eq(materials.ownerId, ownerId), inArray(materials.id, unique)));
}

/**
 * Give a brand new account something to estimate against.
 *
 * Idempotent: if the account already has any material, this does nothing. An
 * account that deliberately emptied its catalog should stay empty.
 */
export async function seedCatalogIfEmpty(ownerId: string): Promise<number> {
  const existing = await db
    .select({ id: materials.id })
    .from(materials)
    .where(eq(materials.ownerId, ownerId))
    .limit(1);
  if (existing.length > 0) return 0;

  const rows = seedRowsFor(ownerId);
  const inserted = await db.insert(materials).values(rows).onConflictDoNothing().returning({
    id: materials.id,
  });
  return inserted.length;
}
