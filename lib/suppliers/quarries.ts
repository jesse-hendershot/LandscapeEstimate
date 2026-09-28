/**
 * Every active quarry and gravel pit near a job, from federal mine records.
 *
 * The Mine Safety and Health Administration registers every surface mine that
 * sells crushed stone or sand and gravel, with coordinates. That's the list of
 * places a truck can go for rock — including the ones a shop has never heard
 * of, which is where the price differences hide.
 *
 * The data is a snapshot in data/msha-quarries.json, rebuilt by
 * scripts/import-quarries.ts (monthly, via GitHub Actions). MSHA coordinates
 * are self-reported by operators and a few are plainly wrong, so the UI says
 * "call to confirm" and nothing here is used for pricing until the shop adds
 * the quarry as a supplier.
 */

import raw from "../../data/msha-quarries.json";
import { haversineMiles, roadMilesEstimate, type LatLng } from "../geo/geo";

export interface Quarry {
  id: string;
  name: string;
  operator: string;
  state: string;
  county: string;
  lat: number;
  lng: number;
  kind: "limestone" | "sand_gravel" | "stone";
  active: boolean;
  town: string;
  directions: string;
}

type Row = [string, string, string, string, string, number, number, string, string, string, string];

export const QUARRIES: Quarry[] = (raw.rows as Row[]).map((r) => ({
  id: r[0],
  name: r[1],
  operator: r[2],
  state: r[3],
  county: r[4],
  lat: r[5],
  lng: r[6],
  kind: r[7] as Quarry["kind"],
  active: r[8] === "A",
  town: r[9],
  directions: r[10],
}));

export const QUARRY_SOURCE = { source: raw.source, generated: raw.generated };

export const KIND_LABEL: Record<Quarry["kind"], string> = {
  limestone: "Crushed limestone",
  sand_gravel: "Sand & gravel",
  stone: "Stone",
};

export interface NearbyQuarry extends Quarry {
  crowMiles: number;
  roadMilesApprox: number;
}

export function quarriesNear(p: LatLng, radiusMiles = 40, limit = 40): NearbyQuarry[] {
  return QUARRIES.map((q) => ({
    ...q,
    crowMiles: haversineMiles(p, q),
    roadMilesApprox: roadMilesEstimate(p, q),
  }))
    .filter((q) => q.crowMiles <= radiusMiles)
    .sort((a, b) => a.crowMiles - b.crowMiles)
    .slice(0, limit);
}
