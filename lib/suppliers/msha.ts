/**
 * Parsing for MSHA's Mines data set. Pure, so it's tested without a download.
 * Used by scripts/import-quarries.ts.
 */

import { inflateRawSync } from "node:zlib";

// Iowa plus a margin into every neighbor.
export const BOX = { south: 40.0, north: 43.8, west: -97.0, east: -89.8 };

export const KEEP_SIC: Record<string, string> = {
  "Crushed, Broken Limestone NEC": "limestone",
  "Construction Sand and Gravel": "sand_gravel",
  "Dimension Limestone": "limestone",
  "Dimension Stone NEC": "stone",
  "Sand, Common": "sand_gravel",
  "Crushed, Broken Stone NEC": "stone",
  "Crushed, Broken Quartzite": "stone",
  "Dimension Quartzite": "stone",
};

// Portable crushing crews register with the office's coordinates, not a pit's.
// Keep a portable record only when it's named for a place.
const CREW = /portable|stripping|crew|drill|rented|grading|various|dept|plant\s*(#|no)|dredge|trommel|screen plant|wash plant|crushing plant|crusher|rip rap/i;
const NOWHERE = /various|portable|varies|commencement|see office|contact office/i;

export function unzipSingle(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip file");
  const method = buf.readUInt16LE(8);
  const flags = buf.readUInt16LE(6);
  let size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (flags & 0x08 || size === 0) {
    // Sizes live in a trailing data descriptor; inflate to the end instead.
    size = buf.length - start;
  }
  const body = buf.subarray(start, start + size);
  const out = method === 8 ? inflateRawSync(body) : body;
  return out.toString("latin1");
}


export type QuarryRow = [string, string, string, string, string, number, number, string, string, string, string];

/** Filter Mines.txt down to the quarries and pits worth listing. */
export function parseMines(text: string): QuarryRow[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split("|").map((s) => s.replace(/"/g, ""));
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const col of ["MINE_ID", "LATITUDE", "LONGITUDE", "PRIMARY_SIC", "CURRENT_MINE_STATUS"]) {
    if (idx[col] === undefined) throw new Error(`Mines.txt no longer has a ${col} column`);
  }

  const rows: QuarryRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = lines[i].split("|").map((s) => s.replace(/^"|"$/g, "").trim());
    const lat = parseFloat(r[idx.LATITUDE]);
    const lng = parseFloat(r[idx.LONGITUDE]);
    if (!(lat >= BOX.south && lat <= BOX.north && lng >= BOX.west && lng <= BOX.east)) continue;
    if (r[idx.COAL_METAL_IND] !== "M") continue;
    const status = r[idx.CURRENT_MINE_STATUS];
    if (status !== "Active" && status !== "Intermittent") continue;
    const kind = KEEP_SIC[r[idx.PRIMARY_SIC]];
    if (!kind) continue;
    const name = r[idx.CURRENT_MINE_NAME];
    const directions = (r[idx.DIRECTIONS_TO_MINE] ?? "").replace(/\s+/g, " ");
    const portable = r[idx.PORTABLE_OPERATION] === "Y";
    if (portable && (CREW.test(name) || NOWHERE.test(directions))) continue;

    rows.push([
      r[idx.MINE_ID],
      name,
      r[idx.CURRENT_OPERATOR_NAME],
      r[idx.STATE],
      r[idx.FIPS_CNTY_NM],
      +lat.toFixed(5),
      +lng.toFixed(5),
      kind,
      status === "Active" ? "A" : "I",
      r[idx.NEAREST_TOWN],
      directions.slice(0, 110),
    ]);
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}
