import { z } from "zod";

import type { Supplier } from "../db/schema";
import { haversineMiles, type LatLng } from "../geo/geo";

export const SUPPLIER_KINDS = ["quarry", "yard", "big_box", "nursery", "sod_farm", "other"] as const;

export function presentSupplier(s: Supplier, shop: LatLng | null, materialCount = 0) {
  const located = s.lat !== null && s.lng !== null;
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    address: s.address,
    phone: s.phone,
    notes: s.notes,
    deliveryFee: s.deliveryFeeCents / 100,
    lat: s.lat,
    lng: s.lng,
    located,
    mshaId: s.mshaId,
    isActive: s.isActive,
    /** Straight-line miles from the shop, for sorting the list. Not used in pricing. */
    milesFromShop: located && shop ? Math.round(haversineMiles(shop, { lat: s.lat!, lng: s.lng! }) * 10) / 10 : null,
    materialCount,
  };
}

export type SupplierDto = ReturnType<typeof presentSupplier>;

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "name is too short").max(160),
  kind: z.enum(SUPPLIER_KINDS).default("yard"),
  address: z.string().trim().max(240).default(""),
  phone: z.string().trim().max(40).default(""),
  notes: z.string().trim().max(600).default(""),
  deliveryFee: z.number().min(0).max(5000).default(0),
  /** Supplied directly when adding from the quarry list. */
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  mshaId: z.string().trim().max(20).nullish(),
});

export const supplierPatchSchema = supplierSchema.partial().extend({ isActive: z.boolean().optional() });
