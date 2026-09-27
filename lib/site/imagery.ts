/**
 * Aerial images of a job site.
 *
 * ArcGIS MapServers render any extent on request (`/export`), so there's no
 * tile stitching: ask for the lot plus a margin, get one JPEG. Requested in Web
 * Mercator so the image is square in ground feet and the parcel outline can be
 * placed on it by straight arithmetic (see mercator.ts).
 *
 * This is what lets the estimator "see" the property: the model gets the photo
 * with the lot lines' pixel coordinates and the scale, and can reason about
 * where the house, driveway and existing beds are.
 */

import { boundsOf, padBounds, type Bounds, type LatLng } from "../geo/geo";
import { fetchWithTimeout } from "../net";
import { feetPerPixel, squareMercBox, toPixel, type MercBox } from "./mercator";
import { aerialServiceFor } from "./sources";

export function exportUrl(service: string, box: MercBox, size: number, format: "jpg" | "png" = "jpg"): string {
  return (
    `${service}/export?` +
    new URLSearchParams({
      bbox: `${box.xmin},${box.ymin},${box.xmax},${box.ymax}`,
      bboxSR: "3857",
      imageSR: "3857",
      size: `${size},${size}`,
      format,
      transparent: "false",
      f: "image",
    })
  );
}

export interface AerialImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png";
  box: MercBox;
  size: number;
  ftPerPx: number;
  service: string;
  /** Lot outline in image pixels, when a ring was given. */
  ringPx: { x: number; y: number }[];
}

/** Frame for a lot (or a point): the ring's bounds plus a margin, squared. */
export function frameFor(ring: LatLng[] | null, center: LatLng, marginFt = 40): Bounds {
  if (ring && ring.length >= 3) return padBounds(boundsOf(ring), marginFt);
  // No lot: a 250 ft square around the point.
  return padBounds(boundsOf([center]), 125);
}

export async function fetchAerial(
  center: LatLng,
  ring: LatLng[] | null,
  size = 768
): Promise<AerialImage | null> {
  const service = aerialServiceFor(center.lat, center.lng);
  const box = squareMercBox(frameFor(ring, center));
  try {
    const res = await fetchWithTimeout(exportUrl(service, box, size), { timeoutMs: 10_000 });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    // An ArcGIS error comes back as JSON or HTML with a 200; only take images.
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) return null; // blank tile
    return {
      base64: buf.toString("base64"),
      mediaType: type.includes("png") ? "image/png" : "image/jpeg",
      box,
      size,
      ftPerPx: feetPerPixel(box, size, center.lat),
      service,
      ringPx: (ring ?? []).map((p) => {
        const px = toPixel(p, box, size);
        return { x: Math.round(px.x), y: Math.round(px.y) };
      }),
    };
  } catch {
    return null;
  }
}
