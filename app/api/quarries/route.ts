import type { NextRequest } from "next/server";

import { HttpError, handle } from "@/lib/api";
import { requireProfile } from "@/lib/auth";
import { geocodeAddress, localityOf } from "@/lib/geo/geocode";
import { QUARRY_SOURCE, quarriesNear } from "@/lib/suppliers/quarries";
import { listSuppliers } from "@/lib/suppliers/repo";

/**
 * GET /api/quarries?address=...&radius=40
 *
 * Federal-record quarries and pits near an address (default: the shop).
 * Each carries `supplierId` when the shop already added it.
 */
export async function GET(req: NextRequest) {
  return handle("find quarries", async () => {
    const profile = await requireProfile();
    const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
    const radius = Math.min(100, Math.max(5, Number(req.nextUrl.searchParams.get("radius")) || 40));

    let center: { lat: number; lng: number } | null = null;
    let centerLabel = "";
    if (address) {
      const g = await geocodeAddress(address, localityOf(profile.shopAddress) || "Iowa City, IA");
      if (!g) throw new HttpError(400, "Couldn't find that address on the map.");
      center = { lat: g.lat, lng: g.lng };
      centerLabel = g.matched || address;
    } else if (profile.shopLat !== null && profile.shopLng !== null) {
      center = { lat: profile.shopLat, lng: profile.shopLng };
      centerLabel = profile.shopAddress || "your shop";
    } else {
      throw new HttpError(400, "Set your shop address in Settings, or type an address to search near.");
    }

    const suppliers = await listSuppliers(profile.id, { includeInactive: true });
    const byMsha = new Map(suppliers.filter((s) => s.mshaId).map((s) => [s.mshaId!, s.id]));

    return {
      center,
      centerLabel,
      radius,
      source: QUARRY_SOURCE,
      quarries: quarriesNear(center, radius).map((q) => ({
        ...q,
        crowMiles: Math.round(q.crowMiles * 10) / 10,
        roadMilesApprox: Math.round(q.roadMilesApprox * 10) / 10,
        supplierId: byMsha.get(q.id) ?? null,
      })),
    };
  });
}
