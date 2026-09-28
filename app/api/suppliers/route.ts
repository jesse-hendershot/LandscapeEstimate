import type { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";

import { handle, parseOr400 } from "@/lib/api";
import { requireProfile } from "@/lib/auth";
import { db } from "@/lib/db";
import { materials } from "@/lib/db/schema";
import { geocodeAddress, localityOf } from "@/lib/geo/geocode";
import { presentSupplier, supplierSchema } from "@/lib/suppliers/present";
import { createSupplier, listSuppliers } from "@/lib/suppliers/repo";

async function counts(ownerId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ supplierId: materials.supplierId, n: sql<number>`count(*)::int` })
    .from(materials)
    .where(eq(materials.ownerId, ownerId))
    .groupBy(materials.supplierId);
  return new Map(rows.filter((r) => r.supplierId).map((r) => [r.supplierId as string, r.n]));
}

export async function GET() {
  return handle("load suppliers", async () => {
    const profile = await requireProfile();
    const shop = profile.shopLat !== null && profile.shopLng !== null ? { lat: profile.shopLat, lng: profile.shopLng } : null;
    const [rows, n] = await Promise.all([listSuppliers(profile.id), counts(profile.id)]);
    return { suppliers: rows.map((s) => presentSupplier(s, shop, n.get(s.id) ?? 0)) };
  });
}

export async function POST(req: NextRequest) {
  return handle("add supplier", async () => {
    const profile = await requireProfile();
    const input = parseOr400(supplierSchema, await req.json());

    let lat = input.lat ?? null;
    let lng = input.lng ?? null;
    let warning: string | null = null;
    if ((lat === null || lng === null) && input.address) {
      const g = await geocodeAddress(input.address, localityOf(profile.shopAddress) || "Iowa");
      lat = g?.lat ?? null;
      lng = g?.lng ?? null;
      if (!g) warning = "Couldn't find that address on the map. Distances to this supplier will be assumed until it's fixed.";
    }

    const row = await createSupplier(profile.id, {
      name: input.name,
      kind: input.kind,
      address: input.address,
      phone: input.phone,
      notes: input.notes,
      deliveryFeeCents: Math.round(input.deliveryFee * 100),
      lat,
      lng,
      mshaId: input.mshaId ?? null,
    });
    const shop = profile.shopLat !== null && profile.shopLng !== null ? { lat: profile.shopLat, lng: profile.shopLng } : null;
    return { supplier: presentSupplier(row, shop), warning };
  });
}
