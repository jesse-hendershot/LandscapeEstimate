/**
 * Supplier data access. Owner-scoped like every other table: there is no
 * function that reads a supplier by id alone.
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";
import { suppliers, type NewSupplier, type Supplier } from "../db/schema";

export async function listSuppliers(ownerId: string, opts: { includeInactive?: boolean } = {}): Promise<Supplier[]> {
  const where = opts.includeInactive
    ? eq(suppliers.ownerId, ownerId)
    : and(eq(suppliers.ownerId, ownerId), eq(suppliers.isActive, true));
  return db.select().from(suppliers).where(where).orderBy(asc(suppliers.name));
}

export async function getSupplier(ownerId: string, id: string): Promise<Supplier | null> {
  const [row] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.ownerId, ownerId), eq(suppliers.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createSupplier(
  ownerId: string,
  input: Omit<NewSupplier, "ownerId" | "id">
): Promise<Supplier> {
  const [row] = await db.insert(suppliers).values({ ...input, ownerId }).returning();
  return row;
}

export async function updateSupplier(
  ownerId: string,
  id: string,
  patch: Partial<Omit<NewSupplier, "ownerId" | "id">>
): Promise<Supplier | null> {
  const [row] = await db
    .update(suppliers)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(suppliers.ownerId, ownerId), eq(suppliers.id, id)))
    .returning();
  return row ?? null;
}

/** Soft delete: catalog rows keep pointing at it for provenance. */
export async function deactivateSupplier(ownerId: string, id: string): Promise<boolean> {
  const [row] = await db
    .update(suppliers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(suppliers.ownerId, ownerId), eq(suppliers.id, id)))
    .returning({ id: suppliers.id });
  return Boolean(row);
}
