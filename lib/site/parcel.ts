/**
 * Parcel lookup: the lot, as the county recorded it.
 *
 * Two ways to find it, tried in order:
 *
 *   1. By address text against the county's own site-address field. This is
 *      exact when it hits, and it also rescues addresses typed without a town
 *      ("2809 Muscatine ave") because the county only has one of those.
 *   2. By location: the parcel under, or nearest to, the geocoded point. The
 *      Census geocoder drops the point in the street, so this searches a
 *      radius and takes the nearest lot rather than requiring a direct hit.
 */

import { edgeLengthsFt, haversineMiles, polygonAreaSqFt, polygonPerimeterFt, type LatLng } from "../geo/geo";
import { fetchJson } from "../net";
import { PARCEL_SOURCES, parcelSourceFor, type ParcelSource } from "./sources";

export interface Parcel {
  county: string;
  id: string;
  address: string;
  city: string;
  /** Outer ring, lat/lng, open (first vertex not repeated). */
  ring: LatLng[];
  centroid: LatLng;
  areaSqFt: number;
  perimeterFt: number;
  edgesFt: number[];
  propClass: string;
  link: string;
}

const STREET_TYPES: Record<string, string> = {
  AVENUE: "AVE", AV: "AVE", STREET: "ST", DRIVE: "DR", ROAD: "RD", LANE: "LN",
  COURT: "CT", PLACE: "PL", BOULEVARD: "BLVD", CIRCLE: "CIR", TRAIL: "TRL",
  PARKWAY: "PKWY", HIGHWAY: "HWY", TERRACE: "TER", WAY: "WAY",
};
const DIRECTIONS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};
const TYPE_ABBR = new Set(Object.values(STREET_TYPES));
const DIR_ABBR = new Set(Object.values(DIRECTIONS));

export interface AddressParts {
  number: string;
  /** The distinctive word(s) of the street name, e.g. "MUSCATINE". */
  core: string;
  city: string;
}

/** Pull house number, street core and city out of a free-typed address. */
export function parseAddress(addr: string): AddressParts | null {
  const segs = addr.split(",").map((s) => s.trim());
  const street = (segs[0] ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const m = street.match(/^(\d+[A-Z]?)\s+(.+)$/);
  if (!m) return null;
  const words = m[2]
    .split(" ")
    .map((w) => STREET_TYPES[w] ?? DIRECTIONS[w] ?? w)
    .filter((w) => !TYPE_ABBR.has(w) && !DIR_ABBR.has(w) && !/^(APT|UNIT|STE|#)$/.test(w));
  // Stop at a unit designator's value
  const core = words.slice(0, 3).join(" ").trim();
  if (!core) return null;
  const city = (segs[1] ?? "").toUpperCase().replace(/[^A-Z ]+/g, "").trim();
  return { number: m[1], core, city };
}

interface EsriGeoJson {
  features?: {
    geometry?: { type: string; coordinates: number[][][] | number[][][][] };
    properties?: Record<string, unknown>;
  }[];
}

function outerRing(geom: { type: string; coordinates: unknown } | undefined): LatLng[] | null {
  if (!geom) return null;
  let ring: number[][] | undefined;
  if (geom.type === "Polygon") ring = (geom.coordinates as number[][][])[0];
  else if (geom.type === "MultiPolygon") {
    // Largest polygon's outer ring.
    const polys = geom.coordinates as number[][][][];
    ring = polys
      .map((p) => p[0])
      .sort(
        (a, b) =>
          polygonAreaSqFt(b.map(([lng, lat]) => ({ lat, lng }))) -
          polygonAreaSqFt(a.map(([lng, lat]) => ({ lat, lng })))
      )[0];
  }
  if (!ring || ring.length < 3) return null;
  const pts = ring.map(([lng, lat]) => ({ lat, lng }));
  const f = pts[0];
  const l = pts[pts.length - 1];
  return f.lat === l.lat && f.lng === l.lng ? pts.slice(0, -1) : pts;
}

export function toParcel(src: ParcelSource, feature: NonNullable<EsriGeoJson["features"]>[number]): Parcel | null {
  const ring = outerRing(feature.geometry as { type: string; coordinates: unknown });
  if (!ring) return null;
  const p = feature.properties ?? {};
  const str = (k?: string) => (k && p[k] != null ? String(p[k]).trim() : "");
  const lat = ring.reduce((a, q) => a + q.lat, 0) / ring.length;
  const lng = ring.reduce((a, q) => a + q.lng, 0) / ring.length;
  return {
    county: src.county,
    id: str(src.fields.id),
    address: str(src.fields.address),
    city: str(src.fields.city),
    ring,
    centroid: { lat, lng },
    areaSqFt: Math.round(polygonAreaSqFt(ring)),
    perimeterFt: Math.round(polygonPerimeterFt(ring)),
    edgesFt: edgeLengthsFt(ring).map((e) => Math.round(e * 10) / 10),
    propClass: str(src.fields.propClass),
    link: str(src.fields.link),
  };
}

function outFields(src: ParcelSource): string {
  return Object.values(src.fields).filter(Boolean).join(",");
}

async function queryByAddress(src: ParcelSource, parts: AddressParts): Promise<Parcel[]> {
  const safeCore = parts.core.replace(/[^A-Z0-9 ]/g, "");
  const safeNum = parts.number.replace(/[^A-Z0-9]/g, "");
  const where = `${src.fields.address} LIKE '${safeNum} %${safeCore}%'`;
  const url =
    `${src.layer}/query?` +
    new URLSearchParams({
      where,
      outFields: outFields(src),
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "10",
      f: "geojson",
    });
  const json = await fetchJson<EsriGeoJson>(url, { timeoutMs: 8000 });
  return (json.features ?? []).map((f) => toParcel(src, f)).filter((x): x is Parcel => Boolean(x));
}

async function queryNear(src: ParcelSource, p: LatLng, radiusFt: number): Promise<Parcel[]> {
  const url =
    `${src.layer}/query?` +
    new URLSearchParams({
      geometry: `${p.lng},${p.lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(radiusFt),
      units: "esriSRUnit_Foot",
      outFields: outFields(src),
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "25",
      f: "geojson",
    });
  const json = await fetchJson<EsriGeoJson>(url, { timeoutMs: 8000 });
  return (json.features ?? []).map((f) => toParcel(src, f)).filter((x): x is Parcel => Boolean(x));
}

/**
 * Find the parcel for a job. `point` is the geocoded location if we have one;
 * it picks the right source county and breaks ties between same-named streets
 * in different towns.
 */
export async function findParcel(address: string, point: LatLng | null): Promise<Parcel | null> {
  const parts = parseAddress(address);
  // A geocode inside a supported county narrows the search to it. One outside
  // every county (or none at all) searches them all by address — the geocoder
  // may simply have put a town-less address in the wrong town.
  const home = point ? parcelSourceFor(point.lat, point.lng) : null;
  const sources = home ? [home] : PARCEL_SOURCES;

  for (const src of sources) {
    if (parts) {
      try {
        const hits = await queryByAddress(src, parts);
        if (hits.length > 0) {
          const scored = hits
            .map((h) => ({
              h,
              cityMatch: parts.city && h.city ? (h.city.includes(parts.city) || parts.city.includes(h.city) ? 0 : 1) : 0,
              exact: h.address.startsWith(`${parts.number} `) ? 0 : 1,
              dist: point ? haversineMiles(point, h.centroid) : 0,
            }))
            .sort((a, b) => a.exact - b.exact || a.cityMatch - b.cityMatch || a.dist - b.dist);
          const best = scored[0];
          // A same-address hit 20 miles from where the geocoder put the job is
          // a different house with the same number.
          if (!point || !home || best.dist < 3) return best.h;
        }
      } catch {
        // fall through to the spatial query
      }
    }
    if (point && home) {
      try {
        const near = await queryNear(src, point, 150);
        if (near.length > 0) {
          return near.sort((a, b) => haversineMiles(point, a.centroid) - haversineMiles(point, b.centroid))[0];
        }
      } catch {
        // no parcel
      }
    }
  }
  return null;
}
