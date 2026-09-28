import type { NextRequest } from "next/server";

import { HttpError, handle, isUuid, parseOr400 } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { materialColumns, presentMaterial } from "@/lib/catalog/present";
import { deactivateMaterial, getMaterial, updateMaterial } from "@/lib/catalog/repo";
import { updateMaterialSchema } from "@/lib/catalog/validate";
import { getSupplier } from "@/lib/suppliers/repo";

/** Next 15 hands route params as a promise. */
type Ctx = { params: Promise<{ id: string }> };

// A miss means either "no such id" or "not yours". Both are 404 on purpose —
// distinguishing them would confirm another account's material ids exist.

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle("load material", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    const row = isUuid(id) ? await getMaterial(ownerId, id) : null;
    if (!row) throw new HttpError(404, "Not found");
    return { material: presentMaterial(row) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle("update material", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "Not found");
    const input = parseOr400(updateMaterialSchema, await req.json());
    if (input.supplierId && !(await getSupplier(ownerId, input.supplierId))) {
      throw new HttpError(400, "Unknown supplier");
    }
    const row = await updateMaterial(ownerId, id, materialColumns(input));
    if (!row) throw new HttpError(404, "Not found");
    return { material: presentMaterial(row) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle("remove material", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    // Soft delete: past estimates reference this row for provenance.
    if (!isUuid(id) || !(await deactivateMaterial(ownerId, id))) throw new HttpError(404, "Not found");
    return { deactivated: true };
  });
}
