/**
 * Everything the public record knows about a job site, gathered once.
 *
 * Every piece is best-effort and time-boxed. A site with no parcel (outside a
 * supported county), no elevation (USGS having a bad day) or no image still
 * gets an estimate — just with less to go on, which the prompt says plainly.
 */

import type { LatLng } from "../geo/geo";
import { geocodeAddress, type GeocodeResult } from "../geo/geocode";
import { settle } from "../net";
import { lineProfile, lotGrade, type LineProfile, type LotGrade } from "./elevation";
import { fetchAerial, type AerialImage } from "./imagery";
import { findParcel, type Parcel } from "./parcel";

export interface Measurement {
  id: string;
  label: string;
  kind: "area" | "line";
  points: LatLng[];
  /** Filled in by the client for areas. */
  sqft?: number;
  /** Filled in by the client for lines (and area perimeters). */
  ft?: number;
  /** Server-filled for lines. */
  profile?: Pick<LineProfile, "startFt" | "endFt" | "fallFt" | "slopePct" | "worstRiseFt" | "lengthFt"> | null;
}

export interface SiteContext {
  job: LatLng | null;
  geocode: GeocodeResult | null;
  parcel: Parcel | null;
  grade: LotGrade | null;
  measurements: Measurement[];
  aerial: AerialImage | null;
}

export async function buildSiteContext(
  address: string,
  opts: { bias?: string; measurements?: Measurement[]; withImage?: boolean } = {}
): Promise<SiteContext> {
  const geocode = await settle(geocodeAddress(address, opts.bias), null, 9000);
  const parcel = await settle(findParcel(address, geocode), null, 9000);

  // The parcel's middle beats a street-centerline geocode for everything
  // downstream: distances, the image frame, elevation.
  const job: LatLng | null = parcel?.centroid ?? (geocode ? { lat: geocode.lat, lng: geocode.lng } : null);

  const measurements = (opts.measurements ?? []).slice(0, 20);

  const [grade, aerial, profiles] = await Promise.all([
    parcel ? settle(lotGrade(parcel.ring), null, 9000) : Promise.resolve(null),
    job && opts.withImage !== false ? settle(fetchAerial(job, parcel?.ring ?? null), null, 11_000) : Promise.resolve(null),
    Promise.all(
      measurements.map((m) =>
        m.kind === "line" && m.points.length >= 2
          ? settle(lineProfile(m.points, 10), null, 9000)
          : Promise.resolve(null)
      )
    ),
  ]);

  measurements.forEach((m, i) => {
    const p = profiles[i];
    if (p) {
      m.profile = {
        lengthFt: p.lengthFt,
        startFt: p.startFt,
        endFt: p.endFt,
        fallFt: p.fallFt,
        slopePct: p.slopePct,
        worstRiseFt: p.worstRiseFt,
      };
    }
  });

  return { job, geocode, parcel, grade, measurements, aerial };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n).toLocaleString("en-US");

/** The site, in words, for the prompt. */
export function siteContextText(ctx: SiteContext): string {
  const lines: string[] = [];

  if (ctx.parcel) {
    const p = ctx.parcel;
    const sides = p.edgesFt.filter((e) => e >= 3).map((e) => `${Math.round(e)}`).join(", ");
    lines.push(
      `- Parcel (${p.county} records): ${p.address || "address not recorded"}${p.city ? `, ${p.city}` : ""}. ` +
        `Lot ${r0(p.areaSqFt)} sq ft, perimeter ${r0(p.perimeterFt)} ft, sides ${sides} ft.`
    );
  } else if (ctx.job) {
    lines.push("- No county parcel record for this address (outside supported counties). Lot size unknown.");
  } else {
    lines.push("- The address could not be located. No lot or grade data.");
  }

  if (ctx.grade) {
    const g = ctx.grade;
    lines.push(
      `- Ground (USGS lidar): high ${r1(g.highFt)} ft, low ${r1(g.lowFt)} ft — ${r1(g.reliefFt)} ft of relief across the lot; water runs toward the ${g.drainsToward}.`
    );
  }

  const ms = ctx.measurements;
  if (ms.length > 0) {
    lines.push("- MEASURED ON THE MAP BY THE ESTIMATOR (exact — use these numbers):");
    for (const m of ms) {
      if (m.kind === "area") {
        lines.push(`    • "${m.label}": area ${r0(m.sqft ?? 0)} sq ft${m.ft ? `, edge ${r0(m.ft)} ft` : ""}`);
      } else {
        const pr = m.profile;
        let grade = "";
        if (pr && pr.fallFt !== null && pr.slopePct !== null) {
          grade =
            `, ground falls ${r1(pr.fallFt)} ft start to end (${r1(pr.slopePct)}%)` +
            (pr.worstRiseFt >= 0.3 ? `, with a ${r1(pr.worstRiseFt)} ft hump along the way` : "");
        }
        lines.push(`    • "${m.label}": line ${r0(m.ft ?? pr?.lengthFt ?? 0)} ft${grade}`);
      }
    }
  }

  if (ctx.aerial) {
    const a = ctx.aerial;
    const ring = a.ringPx.length ? ` Lot boundary in image pixels (x,y from top-left): ${a.ringPx.map((p) => `(${p.x},${p.y})`).join(" ")}.` : "";
    lines.push(
      `- An aerial photo of the site is attached: ${a.size}x${a.size} px, north up, about ${a.ftPerPx.toFixed(2)} ft per pixel.${ring}`
    );
  }

  return lines.join("\n");
}

/** What the client and the saved estimate keep (no image bytes). */
export function siteSummary(ctx: SiteContext) {
  return {
    job: ctx.job,
    matchedAddress: ctx.geocode?.matched ?? null,
    parcel: ctx.parcel
      ? {
          county: ctx.parcel.county,
          id: ctx.parcel.id,
          address: ctx.parcel.address,
          city: ctx.parcel.city,
          areaSqFt: ctx.parcel.areaSqFt,
          perimeterFt: ctx.parcel.perimeterFt,
          edgesFt: ctx.parcel.edgesFt,
          link: ctx.parcel.link,
          ring: ctx.parcel.ring,
        }
      : null,
    grade: ctx.grade
      ? {
          highFt: ctx.grade.highFt,
          lowFt: ctx.grade.lowFt,
          reliefFt: ctx.grade.reliefFt,
          drainsToward: ctx.grade.drainsToward,
        }
      : null,
    measurements: ctx.measurements,
    hadImage: Boolean(ctx.aerial),
  };
}
