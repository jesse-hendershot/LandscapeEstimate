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
import { materials, priceHistory, type Material, type NewMaterial } from "../db/schema";
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
  input: Omit<NewMaterial, "ownerId" | "id">,
  opts: { observedOn?: string } = {}
): Promise<Material> {
  const [row] = await db
    .insert(materials)
    .values({ ...input, ownerId })
    .returning();
  await recordPrice(ownerId, row, opts.observedOn);
  return row;
}

/** Append the material's current price to its history. Never fails the caller. */
export async function recordPrice(ownerId: string, m: Material, observedOn = ""): Promise<void> {
  try {
    await db.insert(priceHistory).values({
      ownerId,
      materialId: m.id,
      supplierId: m.supplierId,
      unitCostCents: m.unitCostCents,
      unit: m.unit,
      source: m.priceSource,
      sourceLabel: m.priceSourceLabel,
      observedOn,
    });
  } catch (err) {
    console.error("price history write failed", { materialId: m.id, err });
  }
}

export async function priceHistoryFor(ownerId: string, materialId: string, limit = 20) {
  return db
    .select()
    .from(priceHistory)
    .where(and(eq(priceHistory.ownerId, ownerId), eq(priceHistory.materialId, materialId)))
    .orderBy(desc(priceHistory.createdAt))
    .limit(limit);
}

export async function updateMaterial(
  ownerId: string,
  id: string,
  patch: Partial<Omit<NewMaterial, "ownerId" | "id">>,
  opts: { observedOn?: string } = {}
): Promise<Material | null> {
  const next: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  // A price change stamps its own timestamp so you can see at a glance which
  // catalog entries have gone stale — and says where the new price came from.
  // A price typed into the catalog is the shop's own ("manual") unless the
  // caller (a price sheet or receipt import) says otherwise.
  const priced = patch.unitCostCents !== undefined;
  if (priced) {
    next.priceUpdatedAt = new Date();
    if (patch.priceSource === undefined) {
      next.priceSource = "manual";
      next.priceSourceLabel = "Entered by hand";
    }
  }

  const [row] = await db
    .update(materials)
    .set(next)
    .where(and(eq(materials.ownerId, ownerId), eq(materials.id, id)))
    .returning();
  if (row && priced) await recordPrice(ownerId, row, opts.observedOn);
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
