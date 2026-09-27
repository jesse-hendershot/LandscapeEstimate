import type { NextRequest } from "next/server";

import { HttpError, handle } from "@/lib/api";
import { requireProfile } from "@/lib/auth";
import { localityOf } from "@/lib/geo/geocode";
import { buildSiteContext, siteSummary } from "@/lib/site/context";
import { aerialServiceFor } from "@/lib/site/sources";

/**
 * GET /api/site?address=...
 *
 * What the map needs to open on a job: where it is, the lot lines, which way
 * the ground falls, and which aerial service covers it. No image bytes — the
 * map loads tiles itself.
 */
export async function GET(req: NextRequest) {
  return handle("look up site", async () => {
    const profile = await requireProfile();
    const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
    if (!address) throw new HttpError(400, "address is required");
    const ctx = await buildSiteContext(address, {
      bias: localityOf(profile.shopAddress) || "Iowa City, IA",
      withImage: false,
    });
    if (!ctx.job) throw new HttpError(404, "Couldn't find that address on the map.");
    return {
      ...siteSummary(ctx),
      aerialService: aerialServiceFor(ctx.job.lat, ctx.job.lng),
    };
  });
}
