/**
 * MSHA import tests.  npx tsx --test lib/suppliers/msha.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { parseMines, unzipSingle } from "./msha";
import { QUARRIES, quarriesNear } from "./quarries";

const HEADER = [
  "MINE_ID", "CURRENT_MINE_NAME", "COAL_METAL_IND", "CURRENT_MINE_STATUS", "CURRENT_OPERATOR_NAME",
  "STATE", "FIPS_CNTY_NM", "PRIMARY_SIC", "PORTABLE_OPERATION", "LONGITUDE", "LATITUDE",
  "DIRECTIONS_TO_MINE", "NEAREST_TOWN",
].map((h) => `"${h}"`).join("|");

const row = (vals: string[]) => vals.map((v) => `"${v}"`).join("|");

const TXT = [
  HEADER,
  row(["1300193", "Conklin Quarry and Mill", "M", "Active", "River Products", "IA", "Johnson", "Crushed, Broken Limestone NEC", "N", "-91.547222", "41.693611", "North of Exit 242", "Iowa City"]),
  row(["1300999", "Old Pit", "M", "Abandoned", "Nobody", "IA", "Johnson", "Construction Sand and Gravel", "N", "-91.5", "41.6", "", "Iowa City"]),
  row(["1301292", "Portable Crushing Dept 425", "M", "Intermittent", "Wendling", "IA", "Clinton", "Crushed, Broken Limestone NEC", "Y", "-90.58", "41.85", "Portable operation", "Dewitt"]),
  row(["1300017", "LEE CRAWFORD QY CO", "M", "Active", "Lee Crawford", "IA", "Linn", "Crushed, Broken Limestone NEC", "Y", "-91.74806", "41.98944", "Off I-380 north side", "Cedar Rapids"]),
  row(["1300049", "Gypsum Mine", "M", "Active", "X", "IA", "Webster", "Gypsum", "N", "-94.2", "42.5", "", "Fort Dodge"]),
  row(["0100003", "Alabama Quarry", "M", "Active", "Y", "AL", "Shelby", "Crushed, Broken Limestone NEC", "N", "-86.75", "33.17", "", "Calera"]),
  "",
].join("\r\n");

function zipOf(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content, "latin1"));
  const nameBuf = Buffer.from(name);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0, 6);
  h.writeUInt16LE(8, 8);
  h.writeUInt32LE(data.length, 18);
  h.writeUInt32LE(content.length, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, nameBuf, data, Buffer.from("PK\x01\x02 central directory follows")]);
}

test("unzips the single Mines.txt entry", () => {
  assert.equal(unzipSingle(zipOf("Mines.txt", TXT)), TXT);
  assert.throws(() => unzipSingle(Buffer.from("not a zip at all, clearly")));
});

test("keeps active aggregate sites near Iowa, drops the rest", () => {
  const rows = parseMines(TXT);
  const ids = rows.map((r) => r[0]);
  assert.deepEqual(ids, ["1300017", "1300193"]);
  // A portable record named for a place (Lee Crawford) survives; a crew doesn't.
  const conklin = rows.find((r) => r[0] === "1300193")!;
  assert.equal(conklin[7], "limestone");
  assert.equal(conklin[8], "A");
  assert.equal(conklin[5], 41.69361);
});

test("the shipped dataset loads and finds quarries near Iowa City", () => {
  assert.ok(QUARRIES.length > 100);
  const near = quarriesNear({ lat: 41.6611, lng: -91.5302 }, 15);
  const names = near.map((q) => q.name);
  assert.ok(names.includes("Conklin Quarry and Mill"), names.join(", "));
  assert.ok(names.includes("Klein Quarry"));
  // Sorted nearest first
  for (let i = 1; i < near.length; i++) assert.ok(near[i].crowMiles >= near[i - 1].crowMiles);
});
