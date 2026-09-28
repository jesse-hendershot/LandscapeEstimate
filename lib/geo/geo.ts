/**
 * Plane and sphere geometry for job sites.
 *
 * Everything a landscaping job needs happens inside a few hundred feet, so
 * areas and lengths use a local equirectangular projection around the shape's
 * own centroid. At Iowa latitudes over a residential lot the error is far below
 * a tape measure's — a 10,000 sq ft lot comes out within a square foot or two.
 *
 * Distances between towns use the haversine formula. Road distance is a
 * separate question (see `lib/geo/routing.ts`); `roadMilesEstimate` exists only
 * as the fallback when no routing service is configured.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_FT = 20_902_231; // mean radius, feet
const EARTH_RADIUS_MI = 3958.7613;
const FT_PER_MI = 5280;

const rad = (d: number) => (d * Math.PI) / 180;

export function isLatLng(p: unknown): p is LatLng {
  if (!p || typeof p !== "object") return false;
  const { lat, lng } = p as Record<string, unknown>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** Great-circle distance in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line miles to a rough driving distance.
 *
 * 1.3 is the circuity factor usually quoted for rural US road networks. Iowa's
 * section-line grid pushes real trips toward the Manhattan distance, which for
 * a diagonal trip is up to 1.41x the straight line, so 1.3 sits between the
 * best and worst case. Anything priced with this is labelled approximate.
 */
export const ROAD_CIRCUITY = 1.3;

export function roadMilesEstimate(a: LatLng, b: LatLng): number {
  return haversineMiles(a, b) * ROAD_CIRCUITY;
}

// ── local plane projection ─────────────────────────────────────────────────

function centroidOf(points: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/** Project to feet east/north of `origin`. */
export function toLocalFeet(p: LatLng, origin: LatLng): { x: number; y: number } {
  const x = rad(p.lng - origin.lng) * EARTH_RADIUS_FT * Math.cos(rad(origin.lat));
  const y = rad(p.lat - origin.lat) * EARTH_RADIUS_FT;
  return { x, y };
}

/** Inverse of toLocalFeet. */
export function fromLocalFeet(x: number, y: number, origin: LatLng): LatLng {
  const lat = origin.lat + (y / EARTH_RADIUS_FT) * (180 / Math.PI);
  const lng =
    origin.lng + (x / (EARTH_RADIUS_FT * Math.cos(rad(origin.lat)))) * (180 / Math.PI);
  return { lat, lng };
}

/** Area of a simple polygon in square feet. Ring may be open or closed. */
export function polygonAreaSqFt(ring: LatLng[]): number {
  const pts = openRing(ring);
  if (pts.length < 3) return 0;
  const origin = centroidOf(pts);
  const xy = pts.map((p) => toLocalFeet(p, origin));
  let twice = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** Perimeter of a polygon in feet. */
export function polygonPerimeterFt(ring: LatLng[]): number {
  const pts = openRing(ring);
  if (pts.length < 2) return 0;
  return lineLengthFt([...pts, pts[0]]);
}

/** Length of a polyline in feet. */
export function lineLengthFt(line: LatLng[]): number {
  if (line.length < 2) return 0;
  const origin = centroidOf(line);
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const a = toLocalFeet(line[i - 1], origin);
    const b = toLocalFeet(line[i], origin);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Each edge of a polygon, in feet, starting from the first vertex. */
export function edgeLengthsFt(ring: LatLng[]): number[] {
  const pts = openRing(ring);
  if (pts.length < 2) return [];
  const origin = centroidOf(pts);
  const xy = pts.map((p) => toLocalFeet(p, origin));
  return xy.map((a, i) => {
    const b = xy[(i + 1) % xy.length];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
}

/**
 * Evenly spaced points along a polyline, endpoints included.
 *
 * Used to sample ground elevation along a drain run. `count` is clamped to at
 * least 2 so a two-vertex line always returns its ends.
 */
export function samplesAlong(line: LatLng[], count: number): { point: LatLng; distFt: number }[] {
  const n = Math.max(2, Math.floor(count));
  if (line.length === 0) return [];
  if (line.length === 1) return [{ point: line[0], distFt: 0 }];

  const origin = centroidOf(line);
  const xy = line.map((p) => toLocalFeet(p, origin));
  const segLen: number[] = [];
  let total = 0;
  for (let i = 1; i < xy.length; i++) {
    const d = Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
    segLen.push(d);
    total += d;
  }
  if (total === 0) return [{ point: line[0], distFt: 0 }];

  const out: { point: LatLng; distFt: number }[] = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let acc = 0;
    let seg = 0;
    while (seg < segLen.length - 1 && acc + segLen[seg] < target) {
      acc += segLen[seg];
      seg++;
    }
    const t = segLen[seg] === 0 ? 0 : Math.min(1, (target - acc) / segLen[seg]);
    const a = xy[seg];
    const b = xy[seg + 1];
    out.push({
      point: fromLocalFeet(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, origin),
      distFt: target,
    });
  }
  return out;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function boundsOf(points: LatLng[]): Bounds {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return { south, west, north, east };
}

/** Grow bounds by `ft` feet on every side. */
export function padBounds(b: Bounds, ft: number): Bounds {
  const sw = fromLocalFeet(-ft, -ft, { lat: b.south, lng: b.west });
  const ne = fromLocalFeet(ft, ft, { lat: b.north, lng: b.east });
  return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}

/** Make bounds square in ground feet (so an image of it has square pixels). */
export function squareBounds(b: Bounds): Bounds {
  const center: LatLng = { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
  const sw = toLocalFeet({ lat: b.south, lng: b.west }, center);
  const ne = toLocalFeet({ lat: b.north, lng: b.east }, center);
  const half = Math.max(ne.x - sw.x, ne.y - sw.y) / 2;
  const a = fromLocalFeet(-half, -half, center);
  const c = fromLocalFeet(half, half, center);
  return { south: a.lat, west: a.lng, north: c.lat, east: c.lng };
}

export function boundsSizeFt(b: Bounds): { widthFt: number; heightFt: number } {
  const center: LatLng = { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
  const sw = toLocalFeet({ lat: b.south, lng: b.west }, center);
  const ne = toLocalFeet({ lat: b.north, lng: b.east }, center);
  return { widthFt: ne.x - sw.x, heightFt: ne.y - sw.y };
}

/** Ray-casting point-in-polygon on raw lat/lng (fine at parcel scale). */
export function pointInPolygon(p: LatLng, ring: LatLng[]): boolean {
  const pts = openRing(ring);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    const crosses =
      a.lat > p.lat !== b.lat > p.lat &&
      p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Drop a duplicated closing vertex, if present. */
export function openRing(ring: LatLng[]): LatLng[] {
  if (ring.length > 1) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f.lat === l.lat && f.lng === l.lng) return ring.slice(0, -1);
  }
  return ring;
}

export const milesToFeet = (mi: number) => mi * FT_PER_MI;

/** Round a coordinate for use as a cache key (~11 m at 4 decimals). */
export function coordKey(p: LatLng, decimals = 4): string {
  return `${p.lat.toFixed(decimals)},${p.lng.toFixed(decimals)}`;
}
