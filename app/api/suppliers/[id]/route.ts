import type { NextRequest } from "next/server";

import { HttpError, handle, isUuid, parseOr400 } from "@/lib/api";
import { requireProfile } from "@/lib/auth";
import { geocodeAddress, localityOf } from "@/lib/geo/geocode";
import { presentSupplier, supplierPatchSchema } from "@/lib/suppliers/present";
import { deactivateSupplier, getSupplier, updateSupplier } from "@/lib/suppliers/repo";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle("update supplier", async () => {
    const profile = await requireProfile();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "Not found");
    const before = await getSupplier(profile.id, id);
    if (!before) throw new HttpError(404, "Not found");

    const input = parseOr400(supplierPatchSchema, await req.json());
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "kind", "address", "phone", "notes", "isActive"] as const) {
      if (input[k] !== undefined) patch[k] = input[k];
    }
    if (input.deliveryFee !== undefined) patch.deliveryFeeCents = Math.round(input.deliveryFee * 100);

    let warning: string | null = null;
    if (input.lat != null && input.lng != null) {
      patch.lat = input.lat;
      patch.lng = input.lng;
    } else if (input.address !== undefined && input.address !== before.address) {
      const g = input.address ? await geocodeAddress(input.address, localityOf(profile.shopAddress) || "Iowa") : null;
      patch.lat = g?.lat ?? null;
      patch.lng = g?.lng ?? null;
      if (input.address && !g) warning = "Couldn't find that address on the map.";
    }

    const row = await updateSupplier(profile.id, id, patch);
    if (!row) throw new HttpError(404, "Not found");
    const shop = profile.shopLat !== null && profile.shopLng !== null ? { lat: profile.shopLat, lng: profile.shopLng } : null;
    return { supplier: presentSupplier(row, shop), warning };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle("remove supplier", async () => {
    const profile = await requireProfile();
    const { id } = await params;
    if (!isUuid(id) || !(await deactivateSupplier(profile.id, id))) throw new HttpError(404, "Not found");
    return { removed: true };
  });
}
