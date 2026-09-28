/**
 * Public-data parsers, tested against responses captured from the live
 * services on 2026-09-27.  npx tsx --test lib/site/site.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { hasLocality, localityOf, normalizeQuery, parseCensus, parseNominatim } from "../geo/geocode";
import { parseOrs, pairKey } from "../geo/routing";
import { parseEiaApi, parseEiaHistoryHtml } from "../haul/fuel";
import { bearing, summarizeLot, summarizeProfile } from "./elevation";
import { feetPerPixel, squareMercBox, tileMercBox, toMercator, toPixel } from "./mercator";
import { parseAddress, toParcel } from "./parcel";
import { PARCEL_SOURCES, parcelSourceFor } from "./sources";

// ── geocoding ──────────────────────────────────────────────────────────────

const CENSUS = {
  result: {
    addressMatches: [
      {
        coordinates: { x: -91.522994508181, y: 41.655017219605 },
        matchedAddress: "527 S GOVERNOR ST, IOWA CITY, IA, 52240",
      },
    ],
  },
};

test("census geocoder response", () => {
  const r = parseCensus(CENSUS)!;
  assert.equal(r.lat, 41.655017219605);
  assert.equal(r.lng, -91.522994508181);
  assert.match(r.matched, /GOVERNOR/);
  assert.equal(parseCensus({ result: { addressMatches: [] } }), null);
});

test("nominatim response", () => {
  const r = parseNominatim([{ lat: "41.6420", lon: "-91.5720", display_name: "Menards, Iowa City" }])!;
  assert.equal(r.lng, -91.572);
  assert.equal(parseNominatim([]), null);
});

test("address helpers", () => {
  assert.equal(hasLocality("2809 Muscatine ave"), false);
  assert.equal(hasLocality("2809 Muscatine Ave, Iowa City"), true);
  assert.equal(hasLocality("2809 Muscatine Ave 52240"), true);
  assert.equal(localityOf("123 Main St, Iowa City, IA 52240"), "Iowa City, IA");
  assert.equal(localityOf("123 Main St"), "");
  assert.equal(normalizeQuery("  Menards – Iowa City,Hwy 1 W "), "menards - iowa city, hwy 1 w");
});

test("parcel address parsing keeps the distinctive street word", () => {
  assert.deepEqual(parseAddress("2809 Muscatine ave"), { number: "2809", core: "MUSCATINE", city: "" });
  assert.deepEqual(parseAddress("527 South Governor Street, Iowa City, IA"), { number: "527", core: "GOVERNOR", city: "IOWA CITY" });
  assert.deepEqual(parseAddress("412 Melrose Ave, Iowa City, IA 52246")?.core, "MELROSE");
  assert.equal(parseAddress("Muscatine Ave"), null);
});

// ── county parcel ──────────────────────────────────────────────────────────

const PARCEL_GEOJSON = {
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [[
      [-91.523609107844337, 41.654803052453317],
      [-91.523609400844492, 41.654748165163696],
      [-91.523609899756508, 41.65465485768371],
      [-91.523061007483676, 41.654652979088375],
      [-91.52306050058516, 41.654746286443292],
      [-91.52306020352249, 41.654801173670151],
      [-91.523609107844337, 41.654803052453317],
    ]],
  },
  properties: {
    PPN: "1015102027",
    SiteAddress: "527 S GOVERNOR ST",
    City: "IOWA CITY",
    Shape_Area: 8100.2164494436911,
    PropClass: "R",
    Assessors_Link: "https://iowacity.iowaassessors.com/parcel/1015102027",
  },
};

test("county parcel feature becomes a lot with area, sides and a link", () => {
  const src = PARCEL_SOURCES[0];
  const p = toParcel(src, PARCEL_GEOJSON as never)!;
  assert.equal(p.id, "1015102027");
  assert.equal(p.address, "527 S GOVERNOR ST");
  assert.equal(p.ring.length, 6); // closing vertex dropped
  assert.ok(Math.abs(p.areaSqFt - 8100) < 40);
  assert.match(p.link, /iowaassessors/);
  assert.ok(p.perimeterFt > 400 && p.perimeterFt < 420);
});

test("the Johnson County source covers Iowa City but not Cedar Rapids", () => {
  assert.equal(parcelSourceFor(41.6611, -91.5302)?.county, "Johnson County, IA");
  assert.equal(parcelSourceFor(41.9779, -91.6656), null);
});

// ── elevation ──────────────────────────────────────────────────────────────

test("a drain line's profile: fall, slope and a hump to dig through", () => {
  const pts = [690, 689.5, 689.9, 688.4, 687.0].map((e, i) => ({ distFt: i * 25, elevFt: e, point: { lat: 0, lng: 0 } }));
  const p = summarizeProfile(100, pts);
  assert.equal(p.fallFt, 3);
  assert.equal(p.slopePct, 3);
  assert.equal(p.worstRiseFt, 0.4); // 689.5 -> 689.9
  assert.equal(p.highFt, 690);
});

test("a line drawn uphill is still read correctly", () => {
  const pts = [687, 688, 690].map((e, i) => ({ distFt: i * 50, elevFt: e, point: { lat: 0, lng: 0 } }));
  const p = summarizeProfile(100, pts);
  assert.equal(p.fallFt, -3);
  assert.equal(p.worstRiseFt, 0);
});

test("missing elevations are skipped, never treated as zero", () => {
  const pts = [690, null, 688].map((e, i) => ({ distFt: i * 50, elevFt: e, point: { lat: 0, lng: 0 } }));
  const p = summarizeProfile(100, pts);
  assert.equal(p.fallFt, 2);
});

test("lot grade reads which way water runs", () => {
  const g = summarizeLot([
    { point: { lat: 41.65, lng: -91.5 }, elevFt: 690 },
    { point: { lat: 41.6497, lng: -91.5004 }, elevFt: 685 },
  ])!;
  assert.equal(g.reliefFt, 5);
  assert.equal(g.drainsToward, "southwest");
  assert.equal(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), "north");
});

// ── imagery math ───────────────────────────────────────────────────────────

test("web mercator: the export extent the county returned for the test lot", () => {
  // Requested 60 m either side of the lot centroid; the county echoed this extent.
  const c = toMercator({ lat: 41.649439, lng: -91.495264 });
  assert.ok(Math.abs(c.x - 60 - -10185266.198476134) < 0.01);
  assert.ok(Math.abs(c.y - 60 - 5108550.899031974) < 0.01);
});

test("a lot's frame is square and its corners land on the image", () => {
  const box = squareMercBox({ south: 41.6546, west: -91.5237, north: 41.6549, east: -91.5230 });
  assert.ok(Math.abs(box.xmax - box.xmin - (box.ymax - box.ymin)) < 1e-6);
  const px = toPixel({ lat: 41.65475, lng: -91.52335 }, box, 768);
  assert.ok(px.x > 0 && px.x < 768 && px.y > 0 && px.y < 768);
  const fpp = feetPerPixel(box, 768, 41.65);
  assert.ok(fpp > 0.1 && fpp < 1, `ft/px ${fpp}`);
});

test("slippy tile bounds", () => {
  const b = tileMercBox(0, 0, 0);
  assert.ok(Math.abs(b.xmin + 20037508.34) < 1);
  assert.ok(Math.abs(b.ymax - 20037508.34) < 1);
});

// ── routing and diesel ─────────────────────────────────────────────────────

test("openrouteservice response and order-independent cache keys", () => {
  const r = parseOrs({ features: [{ properties: { summary: { distance: 16093.44, duration: 1200 } } }] })!;
  assert.ok(Math.abs(r.miles - 10) < 1e-9);
  assert.equal(r.minutes, 20);
  const a = { lat: 41.6, lng: -91.5 };
  const b = { lat: 41.7, lng: -91.6 };
  assert.equal(pairKey(a, b), pairKey(b, a));
});

// Two rows exactly as EIA's history page renders them.
const EIA_ROWS = `<tr> <td class="B6">&nbsp;&nbsp;2026-Aug</td> <td class="B5">08/03&nbsp;</td> <td class="B3">5.262&nbsp;&nbsp;&nbsp;</td> <td class="B5">08/10&nbsp;</td> <td class="B3">5.181&nbsp;&nbsp;&nbsp;</td> <td class="B5">08/17&nbsp;</td> <td class="B3">5.435&nbsp;&nbsp;&nbsp;</td> <td class="B5">08/24&nbsp;</td> <td class="B3">5.636&nbsp;&nbsp;&nbsp;</td> <td class="B5">08/31&nbsp;</td> <td class="B3">5.571&nbsp;&nbsp;&nbsp;</td> </tr>
<tr> <td class="B6">&nbsp;&nbsp;2026-Sep</td> <td class="B5">09/07&nbsp;</td> <td class="B3">5.946&nbsp;&nbsp;&nbsp;</td> <td class="B5">09/14&nbsp;</td> <td class="B3">6.250&nbsp;&nbsp;&nbsp;</td> <td class="B5">09/21&nbsp;</td> <td class="B3">6.680&nbsp;&nbsp;&nbsp;</td> <td class="B5">&nbsp;</td> <td class="B3">&nbsp;&nbsp;&nbsp;</td> <td class="B5">&nbsp;</td> <td class="B3">&nbsp;&nbsp;&nbsp;</td> </tr>`;

test("EIA history page: the latest week wins, blank cells ignored", () => {
  assert.deepEqual(parseEiaHistoryHtml(EIA_ROWS), { period: "2026-09-21", dollars: 6.68 });
  assert.equal(parseEiaHistoryHtml("<html>maintenance</html>"), null);
});

test("EIA API v2 response", () => {
  assert.deepEqual(
    parseEiaApi({ response: { data: [{ period: "2026-09-14", value: "6.25" }, { period: "2026-09-21", value: 6.68 }] } }),
    { period: "2026-09-21", dollars: 6.68 }
  );
  assert.equal(parseEiaApi({ error: "invalid key" }), null);
});
