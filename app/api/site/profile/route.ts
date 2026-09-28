import type { NextRequest } from "next/server";

import { HttpError, handle } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { isLatLng } from "@/lib/geo/geo";
import { lineProfile } from "@/lib/site/elevation";

/**
 * POST /api/site/profile  { points: [{lat,lng}, ...] }
 *
 * Ground elevation along a line drawn on the map: start, end, fall, slope and
 * any hump in between. USGS 3DEP lidar, 1 m.
 */
export async function POST(req: NextRequest) {
  return handle("elevation profile", async () => {
    await requireOwner();
    const body = (await req.json()) as { points?: unknown[] };
    const points = (body.points ?? []).filter(isLatLng).slice(0, 100);
    if (points.length < 2) throw new HttpError(400, "Draw at least two points.");
    const p = await lineProfile(points, 10);
    return {
      lengthFt: p.lengthFt,
      startFt: p.startFt,
      endFt: p.endFt,
      fallFt: p.fallFt,
      slopePct: p.slopePct,
      worstRiseFt: p.worstRiseFt,
      points: p.points.map((x) => ({ distFt: x.distFt, elevFt: x.elevFt })),
    };
  });
}
