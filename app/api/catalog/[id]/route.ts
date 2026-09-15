import { NextRequest, NextResponse } from "next/server";

import { authErrorResponse, requireOwner } from "@/lib/auth";
import { deactivateMaterial, getMaterial, updateMaterial } from "@/lib/catalog/repo";
import { fieldErrors, updateMaterialSchema } from "@/lib/catalog/validate";
import { fromCents, toCents } from "@/lib/money";
import type { Material } from "@/lib/db/schema";

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

/** Next 15 hands route params as a promise. */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const ownerId = await requireOwner();
    const { id } = await params;

    const row = await getMaterial(ownerId, id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ material: present(row) });
  } catch (err) {
    const unauth = authErrorResponse(err);
    if (unauth) return unauth;
    console.error("catalog GET by id failed", err);
    return NextResponse.json({ error: "Could not load that material" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const ownerId = await requireOwner();
    const { id } = await params;

    const parsed = updateMaterialSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid material", fields: fieldErrors(parsed.error) },
        { status: 400 }
      );
    }

    const { unitCost, sku, ...rest } = parsed.data;
    const patch: Record<string, unknown> = { ...rest };
    if (unitCost !== undefined) patch.unitCostCents = toCents(unitCost);
    if (sku !== undefined) patch.sku = sku ?? null;

    // updateMaterial scopes by ownerId, so a miss means either "no such id" or
    // "not yours". Both are 404 on purpose — distinguishing them would confirm
    // another account's material ids exist.
    const row = await updateMaterial(ownerId, id, patch);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ material: present(row) });
  } catch (err) {
    const unauth = authErrorResponse(err);
    if (unauth) return unauth;

    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      return NextResponse.json(
        { error: "Another material already uses that name." },
        { status: 409 }
      );
    }

    console.error("catalog PATCH failed", err);
    return NextResponse.json({ error: "Could not update that material" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const ownerId = await requireOwner();
    const { id } = await params;

    // Soft delete. Past estimates reference this row for provenance, and a
    // hard delete would leave those lines unable to say where the price came
    // from.
    const ok = await deactivateMaterial(ownerId, id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ deactivated: true });
  } catch (err) {
    const unauth = authErrorResponse(err);
    if (unauth) return unauth;
    console.error("catalog DELETE failed", err);
    return NextResponse.json({ error: "Could not remove that material" }, { status: 500 });
  }
}
