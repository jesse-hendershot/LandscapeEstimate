/**
 * Ground elevation from USGS 3DEP lidar (1 m resolution across Iowa).
 *
 * Grading data was the piece expected to be hard to find. It isn't: the USGS
 * Elevation Point Query Service answers "how high is the ground here" for any
 * point, free, from the same lidar the county contours are drawn from. A drain
 * line drawn on the map becomes a profile — start, end, high point, fall and
 * slope — and a lot becomes a quick read of which way water runs.
 *
 * One HTTP call per point, so samples are kept small (≤ 12) and run a few at a
 * time. A point with no data comes back null and is skipped, never zeroed.
 */

import { samplesAlong, lineLengthFt, boundsOf, pointInPolygon, type LatLng } from "../geo/geo";
import { fetchJson, mapLimit } from "../net";
import { EPQS } from "./sources";

export async function elevationFt(p: LatLng): Promise<number | null> {
  const url =
    `${EPQS}?` +
    new URLSearchParams({
      x: String(p.lng),
      y: String(p.lat),
      wkid: "4326",
      units: "Feet",
      includeDate: "false",
    });
  try {
    const j = await fetchJson<{ value?: number | string }>(url, { timeoutMs: 6000 });
    const v = typeof j.value === "string" ? parseFloat(j.value) : j.value;
    // EPQS reports no-data as a large negative sentinel.
    if (typeof v !== "number" || !Number.isFinite(v) || v < -1000) return null;
    return v;
  } catch {
    return null;
  }
}

export interface ProfilePoint {
  distFt: number;
  elevFt: number | null;
  point: LatLng;
}

export interface LineProfile {
  lengthFt: number;
  points: ProfilePoint[];
  startFt: number | null;
  endFt: number | null;
  /** start minus end: positive means the line runs downhill from its first point. */
  fallFt: number | null;
  slopePct: number | null;
  highFt: number | null;
  lowFt: number | null;
  /** Any rise along the way that water would have to climb, feet. */
  worstRiseFt: number;
}

/** Pure: summarize elevations along a line. */
export function summarizeProfile(lengthFt: number, points: ProfilePoint[]): LineProfile {
  const known = points.filter((p) => p.elevFt !== null) as (ProfilePoint & { elevFt: number })[];
  const start = known[0]?.elevFt ?? null;
  const end = known.length > 1 ? known[known.length - 1].elevFt : null;
  const fall = start !== null && end !== null ? start - end : null;
  const slope = fall !== null && lengthFt > 0 ? (fall / lengthFt) * 100 : null;

  // Water flows from start to end if fall > 0; a later point higher than an
  // earlier one is a hump it has to get over.
  let worstRise = 0;
  const dir = (fall ?? 0) >= 0 ? 1 : -1;
  let lowSoFar = Infinity;
  const seq = dir === 1 ? known : [...known].reverse();
  for (const p of seq) {
    lowSoFar = Math.min(lowSoFar, p.elevFt);
    worstRise = Math.max(worstRise, p.elevFt - lowSoFar);
  }

  return {
    lengthFt,
    points,
    startFt: start,
    endFt: end,
    fallFt: fall,
    slopePct: slope,
    highFt: known.length ? Math.max(...known.map((p) => p.elevFt)) : null,
    lowFt: known.length ? Math.min(...known.map((p) => p.elevFt)) : null,
    worstRiseFt: Math.round(worstRise * 100) / 100,
  };
}

export async function lineProfile(line: LatLng[], samples = 10): Promise<LineProfile> {
  const lengthFt = lineLengthFt(line);
  const n = Math.max(2, Math.min(12, samples));
  const pts = samplesAlong(line, n);
  const elevs = await mapLimit(pts, 4, (s) => elevationFt(s.point));
  return summarizeProfile(
    lengthFt,
    pts.map((s, i) => ({ distFt: s.distFt, elevFt: elevs[i], point: s.point }))
  );
}

export interface LotGrade {
  highFt: number;
  lowFt: number;
  reliefFt: number;
  high: LatLng;
  low: LatLng;
  /** Compass direction water runs across the lot, from high point to low. */
  drainsToward: string;
  samples: { point: LatLng; elevFt: number }[];
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

export function bearing(a: LatLng, b: LatLng): string {
  const dy = b.lat - a.lat;
  const dx = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Pure: summarize a set of lot samples. */
export function summarizeLot(samples: { point: LatLng; elevFt: number }[]): LotGrade | null {
  if (samples.length < 2) return null;
  const hi = samples.reduce((a, b) => (b.elevFt > a.elevFt ? b : a));
  const lo = samples.reduce((a, b) => (b.elevFt < a.elevFt ? b : a));
  return {
    highFt: hi.elevFt,
    lowFt: lo.elevFt,
    reliefFt: Math.round((hi.elevFt - lo.elevFt) * 10) / 10,
    high: hi.point,
    low: lo.point,
    drainsToward: bearing(hi.point, lo.point),
    samples,
  };
}

/** A 3x3 grid over the lot (points outside the lot dropped), plus its middle. */
export async function lotGrade(ring: LatLng[]): Promise<LotGrade | null> {
  const b = boundsOf(ring);
  const pts: LatLng[] = [];
  for (const fy of [0.15, 0.5, 0.85]) {
    for (const fx of [0.15, 0.5, 0.85]) {
      const p = { lat: b.south + (b.north - b.south) * fy, lng: b.west + (b.east - b.west) * fx };
      if (pointInPolygon(p, ring)) pts.push(p);
    }
  }
  if (pts.length < 2) return null;
  const elevs = await mapLimit(pts, 4, elevationFt);
  const samples = pts
    .map((point, i) => ({ point, elevFt: elevs[i] }))
    .filter((s): s is { point: LatLng; elevFt: number } => s.elevFt !== null);
  return summarizeLot(samples);
}
