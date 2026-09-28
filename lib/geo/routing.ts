/**
 * Road miles between two points.
 *
 * With OPENROUTESERVICE_API_KEY set (free, 2,000 routes a day — far more than
 * a shop uses once results are cached), distances are real truck routes from
 * the "driving-hgv" profile, which keeps dump trucks off roads they can't use.
 *
 * Without a key, distance is the straight line times a road-circuity factor and
 * is flagged approximate everywhere it's shown. Estimated distances are NOT
 * cached, so adding a key later upgrades every pair automatically.
 */

import { eq } from "drizzle-orm";

import { db } from "../db";
import { distanceCache } from "../db/schema";
import { fetchJson } from "../net";
import { coordKey, haversineMiles, roadMilesEstimate, type LatLng } from "./geo";

export interface RoadDistance {
  miles: number;
  minutes: number | null;
  approx: boolean;
  source: "ors" | "estimate";
}

const METERS_PER_MILE = 1609.344;

export function pairKey(a: LatLng, b: LatLng): string {
  // Order-independent: the trip out is the trip back.
  const [x, y] = [coordKey(a), coordKey(b)].sort();
  return `${x}|${y}`;
}

export function parseOrs(json: unknown): { miles: number; minutes: number } | null {
  const f = (json as { features?: { properties?: { summary?: { distance?: number; duration?: number } } }[] })
    ?.features?.[0];
  const s = f?.properties?.summary;
  if (!s || typeof s.distance !== "number") return null;
  return { miles: s.distance / METERS_PER_MILE, minutes: (s.duration ?? 0) / 60 };
}

async function ors(a: LatLng, b: LatLng, key: string) {
  const url =
    "https://api.openrouteservice.org/v2/directions/driving-hgv?" +
    new URLSearchParams({ api_key: key, start: `${a.lng},${a.lat}`, end: `${b.lng},${b.lat}` });
  return parseOrs(await fetchJson(url, { timeoutMs: 8000 }));
}

export async function roadDistance(a: LatLng, b: LatLng): Promise<RoadDistance> {
  // Same spot, or near enough that routing is noise.
  if (haversineMiles(a, b) < 0.05) return { miles: 0, minutes: 0, approx: false, source: "estimate" };

  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (key) {
    const k = pairKey(a, b);
    try {
      const [row] = await db.select().from(distanceCache).where(eq(distanceCache.key, k)).limit(1);
      if (row) return { miles: row.miles, minutes: row.minutes, approx: false, source: "ors" };
    } catch {
      // cache unavailable — fall through to a live call
    }
    try {
      const r = await ors(a, b, key);
      if (r) {
        try {
          await db
            .insert(distanceCache)
            .values({ key: k, miles: r.miles, minutes: r.minutes, source: "ors" })
            .onConflictDoNothing();
        } catch {
          // ignore
        }
        return { miles: r.miles, minutes: r.minutes, approx: false, source: "ors" };
      }
    } catch {
      // routing down — estimate below
    }
  }

  return { miles: roadMilesEstimate(a, b), minutes: null, approx: true, source: "estimate" };
}
