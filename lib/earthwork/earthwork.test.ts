/**
 * Earthwork and geometry tests.  npx tsx --test lib/earthwork/earthwork.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { earthKind } from "./factors";
import { convertBulk, qtyFromDims, roundUpToIncrement } from "./quantity";
import {
  edgeLengthsFt,
  haversineMiles,
  lineLengthFt,
  pointInPolygon,
  polygonAreaSqFt,
  samplesAlong,
  type LatLng,
} from "../geo/geo";

// ── classification ─────────────────────────────────────────────────────────

test("materials classify by what they are, not their exact wording", () => {
  assert.equal(earthKind("Clean stone, 1 in"), "clean_stone");
  assert.equal(earthKind("3/4 in clean limestone"), "clean_stone");
  assert.equal(earthKind("#57 stone"), "clean_stone");
  assert.equal(earthKind("Crushed limestone / road rock"), "road_base");
  assert.equal(earthKind("Class A road stone"), "road_base");
  assert.equal(earthKind("Pea gravel"), "pea_gravel");
  assert.equal(earthKind("River rock"), "river_rock");
  assert.equal(earthKind("Paver / leveling sand"), "sand");
  assert.equal(earthKind("Screened topsoil (bulk)"), "topsoil");
  assert.equal(earthKind("Fill dirt (bulk)"), "fill");
  assert.equal(earthKind("Shredded hardwood mulch (bulk)"), "mulch");
  assert.equal(earthKind("Something odd", "aggregate"), "road_base");
  assert.equal(earthKind("Something odd"), "other");
});

// ── quantities from dimensions ─────────────────────────────────────────────

test("mulch bed: area x depth, no compaction, rounded up to the half yard", () => {
  const r = qtyFromDims({ area_sqft: 420, depth_in: 3 }, { name: "Shredded hardwood mulch", unit: "cu yd" })!;
  // 420 x 0.25 / 27 = 3.889 -> 4.0
  assert.equal(r.qtyMilli, 4000);
  assert.match(r.basis, /420 sq ft at 3 in/);
});

test("compacted base: compaction allowance then tons by density", () => {
  const r = qtyFromDims(
    { length_ft: 30, width_ft: 4, depth_in: 4, compacted: true },
    { name: "Crushed limestone / road rock", unit: "ton" }
  )!;
  // 120 sq ft x 4/12 / 27 = 1.4815 yd x 1.2 = 1.7778 x 1.4 t/yd = 2.489 t -> 2.5
  assert.equal(r.qtyMilli, 2500);
  assert.match(r.basis, /compaction/);
});

test("catalog density beats the default", () => {
  const r = qtyFromDims(
    { length_ft: 30, width_ft: 4, depth_in: 4, compacted: true },
    { name: "Crushed limestone / road rock", unit: "ton", tonsPerCuYdMilli: 1600 }
  )!;
  // 1.7778 yd x 1.6 = 2.844 -> 3.0
  assert.equal(r.qtyMilli, 3000);
});

test("french drain trench: 60 ft x 1 ft x 18 in of clean stone", () => {
  const r = qtyFromDims(
    { length_ft: 60, width_ft: 1, depth_in: 18 },
    { name: "Clean stone, 1 in", unit: "ton" }
  )!;
  // 3.333 yd x 1.05 = 3.5 yd x 1.35 = 4.725 t -> 5.0
  assert.equal(r.qtyMilli, 5000);
});

test("loose-laid material is not inflated unless told it's compacted", () => {
  const r = qtyFromDims({ area_sqft: 270, depth_in: 2, compacted: false }, { name: "Clean stone", unit: "cu yd" })!;
  assert.equal(r.qtyMilli, 2000); // 1.667 -> 2.0
});

test("sod by the sq ft gets 5% for cuts", () => {
  const r = qtyFromDims({ area_sqft: 800 }, { name: "Bluegrass sod", unit: "sq ft" })!;
  assert.equal(r.qtyMilli, 840_000);
});

test("incomplete dims or non-bulk units return null so the model's qty stands", () => {
  assert.equal(qtyFromDims({ area_sqft: 400 }, { name: "mulch", unit: "cu yd" }), null); // no depth
  assert.equal(qtyFromDims({ depth_in: 3 }, { name: "mulch", unit: "cu yd" }), null); // no area
  assert.equal(qtyFromDims({ area_sqft: 400, depth_in: 3 }, { name: "staples", unit: "pack" }), null);
  assert.equal(qtyFromDims(null, { name: "mulch", unit: "cu yd" }), null);
});

test("ton <-> yard conversion and half-unit rounding", () => {
  assert.equal(roundUpToIncrement(3889), 4000);
  assert.equal(roundUpToIncrement(4000), 4000);
  assert.equal(roundUpToIncrement(0), 0);
  assert.equal(convertBulk(10_000, "cu yd", "ton", { name: "road rock", unit: "cu yd" }), 14_000);
  assert.equal(convertBulk(14_000, "ton", "cu yd", { name: "road rock", unit: "ton" }), 10_000);
  assert.equal(convertBulk(1000, "bag", "ton", { name: "x", unit: "bag" }), null);
});

// ── geometry ───────────────────────────────────────────────────────────────

// 527 S Governor St, Iowa City — parcel ring from the Johnson County GIS.
// The county reports Shape_Area = 8100.2 sq ft in state plane.
const PARCEL: LatLng[] = [
  [-91.523609107844337, 41.654803052453317],
  [-91.523609400844492, 41.654748165163696],
  [-91.523609899756508, 41.65465485768371],
  [-91.523061007483676, 41.654652979088375],
  [-91.52306050058516, 41.654746286443292],
  [-91.52306020352249, 41.654801173670151],
  [-91.523609107844337, 41.654803052453317],
].map(([lng, lat]) => ({ lat, lng }));

test("parcel area matches the county's own figure within 0.5%", () => {
  const a = polygonAreaSqFt(PARCEL);
  assert.ok(Math.abs(a - 8100.2) / 8100.2 < 0.005, `got ${a}`);
});

test("parcel edges come out as the platted dimensions (~150 x 54 ft)", () => {
  const edges = edgeLengthsFt(PARCEL).filter((e) => e > 1);
  const longest = Math.max(...edges);
  assert.ok(longest > 148 && longest < 152, `longest edge ${longest}`);
});

test("point in polygon", () => {
  assert.equal(pointInPolygon({ lat: 41.65473, lng: -91.52333 }, PARCEL), true);
  assert.equal(pointInPolygon({ lat: 41.655017, lng: -91.522994 }, PARCEL), false); // the street
});

test("Iowa City to Cedar Rapids is ~23 miles as the crow flies", () => {
  const d = haversineMiles({ lat: 41.6611, lng: -91.5302 }, { lat: 41.9779, lng: -91.6656 });
  assert.ok(d > 22 && d < 24, `got ${d}`);
});

test("line length and sampling along a drain run", () => {
  // ~100 ft due east at Iowa City's latitude
  const a = { lat: 41.66, lng: -91.53 };
  const b = { lat: 41.66, lng: -91.53 + 100 / (364_000 * Math.cos((41.66 * Math.PI) / 180)) };
  const len = lineLengthFt([a, b]);
  assert.ok(Math.abs(len - 100) < 0.5, `got ${len}`);
  const s = samplesAlong([a, b], 5);
  assert.equal(s.length, 5);
  assert.equal(s[0].distFt, 0);
  assert.ok(Math.abs(s[4].distFt - len) < 1e-6);
  assert.ok(Math.abs(s[4].point.lng - b.lng) < 1e-9);
});
