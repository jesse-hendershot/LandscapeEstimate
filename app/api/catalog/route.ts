import type { NextRequest } from "next/server";

import { HttpError, handle, parseOr400 } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { materialColumns, presentMaterial } from "@/lib/catalog/present";
import { createMaterial, listMaterials, seedCatalogIfEmpty } from "@/lib/catalog/repo";
import { createMaterialSchema } from "@/lib/catalog/validate";
import { getSupplier } from "@/lib/suppliers/repo";
import type { NewMaterial } from "@/lib/db/schema";

export async function GET(req: NextRequest) {
  return handle("load catalog", async () => {
    const ownerId = await requireOwner();
    // First visit gets a starter catalog rather than an empty screen. Idempotent.
    await seedCatalogIfEmpty(ownerId);
    const includeInactive = req.nextUrl.searchParams.get("all") === "1";
    const rows = await listMaterials(ownerId, { includeInactive });
    return { materials: rows.map(presentMaterial) };
  });
}

export async function POST(req: NextRequest) {
  return handle("add material", async () => {
    const ownerId = await requireOwner();
    const input = parseOr400(createMaterialSchema, await req.json());
    // A supplier id from the request must belong to this account.
    if (input.supplierId && !(await getSupplier(ownerId, input.supplierId))) {
      throw new HttpError(400, "Unknown supplier");
    }
    const row = await createMaterial(ownerId, materialColumns(input) as Omit<NewMaterial, "ownerId" | "id">);
    return Response.json({ material: presentMaterial(row) }, { status: 201 });
  });
}
