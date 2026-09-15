import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authErrorResponse, requireOwner } from "@/lib/auth";
import {
  createMaterial,
  listMaterials,
  seedCatalogIfEmpty,
} from "@/lib/catalog/repo";
import { createMaterialSchema, fieldErrors } from "@/lib/catalog/validate";
import { fromCents, toCents } from "@/lib/money";
import type { Material } from "@/lib/db/schema";

/** Cents live in the database; dollars cross the wire. Converted only here. */
function present(m: Material) {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    unit: m.unit,
    unitCost: fromCents(m.unitCostCents),
    supplier: m.supplier,
    supplierLocation: m.supplierLocation,
    sku: m.sku,
    coverage: m.coverage,
    notes: m.notes,
    isActive: m.isActive,
    useCount: m.useCount,
    priceUpdatedAt: m.priceUpdatedAt,
  };
}

export async function GET(req: NextRequest) {
  try {
    const ownerId = await requireOwner();

    // First visit gets a starter catalog rather than an empty screen. Idempotent.
    await seedCatalogIfEmpty(ownerId);

    const includeInactive = req.nextUrl.searchParams.get("all") === "1";
    const rows = await listMaterials(ownerId, { includeInactive });

    return NextResponse.json({ materials: rows.map(present) });
  } catch (err) {
    const unauth = authErrorResponse(err);
    if (unauth) return unauth;
    console.error("catalog GET failed", err);
    return NextResponse.json({ error: "Could not load your catalog" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ownerId = await requireOwner();
    const parsed = createMaterialSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid material", fields: fieldErrors(parsed.error) },
        { status: 400 }
      );
    }

    const { unitCost, sku, ...rest } = parsed.data;
    const row = await createMaterial(ownerId, {
      ...rest,
      sku: sku ?? null,
      unitCostCents: toCents(unitCost),
    });

    return NextResponse.json({ material: present(row) }, { status: 201 });
  } catch (err) {
    const unauth = authErrorResponse(err);
    if (unauth) return unauth;

    // The (owner_id, name) unique index is doing real work: two rows with the
    // same name at different prices is exactly the ambiguity the catalog exists
    // to remove, so say so plainly instead of returning a 500.
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      return NextResponse.json(
        { error: "You already have a material with that name — edit that one instead." },
        { status: 409 }
      );
    }

    console.error("catalog POST failed", err);
    return NextResponse.json({ error: "Could not save that material" }, { status: 500 });
  }
}
