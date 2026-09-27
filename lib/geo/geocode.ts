/**
 * Address -> coordinates.
 *
 * Two free sources, tried in order:
 *
 *   1. US Census Bureau geocoder — street addresses, nationwide, no key. It
 *      interpolates along the street centerline, so the point lands in the road
 *      in front of the house rather than on the roof. Good enough for miles to
 *      a quarry; the parcel lookup corrects for it when the lot matters.
 *   2. OpenStreetMap Nominatim — places and businesses ("Menards Iowa City",
 *      "Conklin Quarry"), which the Census geocoder can't do. Its usage policy
 *      asks for a real User-Agent and light traffic; the cache below keeps us
 *      well inside that.
 *
 * Results (including misses) are cached in Postgres, so each address is looked
 * up once. A miss is cached too — retrying a bad address on every estimate
 * would burn the rate limit for nothing — but only for a week.
 */

import { eq } from "drizzle-orm";

import { db } from "../db";
import { geocodeCache } from "../db/schema";
import { fetchJson } from "../net";
import type { LatLng } from "./geo";

export interface GeocodeResult extends LatLng {
  matched: string;
  source: "census" | "nominatim";
}

const MISS_TTL_MS = 7 * 24 * 3600 * 1000;

export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9#,.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

/** Does this look like it names a place (city/state/zip), or just a street? */
export function hasLocality(q: string): boolean {
  return /,/.test(q) || /\b\d{5}\b/.test(q) || /\b(ia|iowa|il|mo|mn|ne|wi|sd)\b/i.test(q);
}

// ── parsers (pure, tested) ─────────────────────────────────────────────────

interface CensusResponse {
  result?: {
    addressMatches?: { coordinates?: { x: number; y: number }; matchedAddress?: string }[];
  };
}

export function parseCensus(json: unknown): GeocodeResult | null {
  const m = (json as CensusResponse)?.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  const { x, y } = m.coordinates;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { lat: y, lng: x, matched: m.matchedAddress ?? "", source: "census" };
}

export function parseNominatim(json: unknown): GeocodeResult | null {
  const first = Array.isArray(json) ? (json[0] as Record<string, unknown>) : null;
  if (!first) return null;
  const lat = parseFloat(String(first.lat));
  const lng = parseFloat(String(first.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, matched: String(first.display_name ?? ""), source: "nominatim" };
}

// ── sources ────────────────────────────────────────────────────────────────

async function census(q: string): Promise<GeocodeResult | null> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" +
    new URLSearchParams({ address: q, benchmark: "Public_AR_Current", format: "json" });
  return parseCensus(await fetchJson(url, { timeoutMs: 8000 }));
}

async function nominatim(q: string): Promise<GeocodeResult | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q, format: "jsonv2", limit: "1", countrycodes: "us" });
  return parseNominatim(await fetchJson(url, { timeoutMs: 8000 }));
}

// ── cached lookup ──────────────────────────────────────────────────────────

async function cached(key: string): Promise<{ hit: boolean; value: GeocodeResult | null }> {
  try {
    const [row] = await db.select().from(geocodeCache).where(eq(geocodeCache.query, key)).limit(1);
    if (!row) return { hit: false, value: null };
    if (row.lat === null || row.lng === null) {
      const fresh = Date.now() - row.createdAt.getTime() < MISS_TTL_MS;
      return { hit: fresh, value: null };
    }
    return {
      hit: true,
      value: { lat: row.lat, lng: row.lng, matched: row.matched, source: row.source as GeocodeResult["source"] },
    };
  } catch {
    return { hit: false, value: null };
  }
}

async function store(key: string, value: GeocodeResult | null) {
  try {
    await db
      .insert(geocodeCache)
      .values({
        query: key,
        lat: value?.lat ?? null,
        lng: value?.lng ?? null,
        matched: value?.matched ?? "",
        source: value?.source ?? "miss",
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: geocodeCache.query,
        set: {
          lat: value?.lat ?? null,
          lng: value?.lng ?? null,
          matched: value?.matched ?? "",
          source: value?.source ?? "miss",
          createdAt: new Date(),
        },
      });
  } catch {
    // A cache write failing is not worth failing an estimate over.
  }
}

async function lookup(q: string, kind: "address" | "place"): Promise<GeocodeResult | null> {
  const key = `${kind}:${normalizeQuery(q)}`;
  const c = await cached(key);
  if (c.hit) return c.value;

  let value: GeocodeResult | null = null;
  try {
    value = kind === "address" ? await census(q) : null;
  } catch {
    value = null;
  }
  if (!value) {
    try {
      value = await nominatim(q);
    } catch {
      value = null;
    }
  }
  await store(key, value);
  return value;
}

/**
 * Geocode a street address. `bias` is a "City, ST" appended when the address
 * has no locality of its own — people type "2809 Muscatine Ave" and mean the
 * one in their own town.
 */
export async function geocodeAddress(q: string, bias?: string): Promise<GeocodeResult | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;
  // No town typed: try the shop's town FIRST. "2809 Muscatine Ave" means the
  // one in Iowa City, not a street in the city of Muscatine 40 miles away.
  if (bias && !hasLocality(trimmed)) {
    const local = await lookup(`${trimmed}, ${bias}`, "address");
    if (local) return local;
  }
  return lookup(trimmed, "address");
}

/** Geocode a business or place name ("Menards - Iowa City, Hwy 1 W"). */
export async function geocodePlace(q: string, bias?: string): Promise<GeocodeResult | null> {
  const cleaned = q.replace(/\s[-–—]\s/g, " ").replace(/\(.*?\)/g, " ").trim();
  if (!cleaned) return null;
  if (bias && !hasLocality(cleaned)) {
    const local = await lookup(`${cleaned}, ${bias}`, "place");
    if (local) return local;
  }
  return lookup(cleaned, "place");
}

/** "Iowa City, IA" out of "123 Main St, Iowa City, IA 52240". */
export function localityOf(address: string): string {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  return parts
    .slice(1)
    .join(", ")
    .replace(/\s*\b\d{5}(-\d{4})?\b/, "")
    .trim();
}
