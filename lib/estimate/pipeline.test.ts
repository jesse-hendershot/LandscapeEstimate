/**
 * Request parsing and the site text the model reads.
 *   npx tsx --test lib/estimate/pipeline.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { siteContextText, type SiteContext } from "../site/context";
import { InputError, parseEstimateInput } from "./pipeline";

test("request parsing keeps what's valid and drops the rest", () => {
  const i = parseEstimateInput({
    jobAddress: " 2809 Muscatine ave ",
    jobDescription: "drainage project",
    trucksForJob: "2",
    measurements: [
      { id: "a", label: "Drain", kind: "line", points: [{ lat: 41.6, lng: -91.5 }, { lat: 41.61, lng: -91.5 }], ft: 120 },
      { kind: "circle", points: [] },
      { kind: "area", points: [{ lat: "x" }] },
    ],
    previousEstimateId: "not-a-uuid",
  });
  assert.equal(i.jobAddress, "2809 Muscatine ave");
  assert.equal(i.trucksForJob, 2);
  assert.equal(i.measurements.length, 1);
  assert.equal(i.measurements[0].ft, 120);
  assert.equal(i.previousEstimateId, null);
  assert.throws(() => parseEstimateInput({ jobAddress: "x" }), InputError);
});

test("the site, in words: lot, grade, exact measurements, image scale", () => {
  const ctx: SiteContext = {
    job: { lat: 41.649, lng: -91.495 },
    geocode: null,
    parcel: {
      county: "Johnson County, IA", id: "1", address: "2809 MUSCATINE AVE", city: "IOWA CITY",
      ring: [], centroid: { lat: 41.649, lng: -91.495 }, areaSqFt: 6580, perimeterFt: 364,
      edgesFt: [50, 132, 50, 132, 0.4], propClass: "R", link: "",
    },
    grade: { highFt: 689.4, lowFt: 684.1, reliefFt: 5.3, high: { lat: 0, lng: 0 }, low: { lat: 0, lng: 0 }, drainsToward: "southwest", samples: [] },
    measurements: [
      { id: "1", label: "front bed", kind: "area", points: [], sqft: 420, ft: 90 },
      { id: "2", label: "drain along east fence", kind: "line", points: [], ft: 85,
        profile: { lengthFt: 85, startFt: 688.9, endFt: 686.6, fallFt: 2.3, slopePct: 2.7, worstRiseFt: 0.5 } },
    ],
    aerial: { base64: "", mediaType: "image/jpeg", box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 }, size: 768, ftPerPx: 0.29, service: "", ringPx: [{ x: 100, y: 120 }, { x: 600, y: 118 }] },
  };
  const t = siteContextText(ctx);
  assert.match(t, /Lot 6,580 sq ft/);
  assert.match(t, /sides 50, 132, 50, 132 ft/); // the 0.4 ft sliver is dropped
  assert.match(t, /water runs toward the southwest/);
  assert.match(t, /"front bed": area 420 sq ft/);
  assert.match(t, /"drain along east fence": line 85 ft, ground falls 2.3 ft start to end \(2.7%\), with a 0.5 ft hump/);
  assert.match(t, /0.29 ft per pixel/);
  assert.match(t, /\(100,120\) \(600,118\)/);
});

test("no location: the model is told plainly", () => {
  const t = siteContextText({ job: null, geocode: null, parcel: null, grade: null, measurements: [], aerial: null });
  assert.match(t, /could not be located/);
});
