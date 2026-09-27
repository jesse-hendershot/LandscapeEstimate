/**
 * Web Mercator (EPSG:3857) helpers.
 *
 * Aerial images are requested in Web Mercator because it's conformal: a square
 * patch of ground is a square patch of image, so pixels map to feet linearly
 * and a parcel outline can be placed on the picture exactly. It's also what
 * Leaflet uses, so the same math builds map tiles.
 */

import type { Bounds, LatLng } from "../geo/geo";

const R = 6378137;

export function toMercator(p: LatLng): { x: number; y: number } {
  const lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat));
  return {
    x: (R * p.lng * Math.PI) / 180,
    y: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  };
}

export function fromMercator(x: number, y: number): LatLng {
  return {
    lng: (x / R) * (180 / Math.PI),
    lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI),
  };
}

export interface MercBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** Square mercator box covering `b`, centered on it. */
export function squareMercBox(b: Bounds): MercBox {
  const sw = toMercator({ lat: b.south, lng: b.west });
  const ne = toMercator({ lat: b.north, lng: b.east });
  const cx = (sw.x + ne.x) / 2;
  const cy = (sw.y + ne.y) / 2;
  const half = Math.max(ne.x - sw.x, ne.y - sw.y) / 2;
  return { xmin: cx - half, ymin: cy - half, xmax: cx + half, ymax: cy + half };
}

/** Pixel position of a point on an image of `box` rendered at `size` x `size`. */
export function toPixel(p: LatLng, box: MercBox, size: number): { x: number; y: number } {
  const m = toMercator(p);
  return {
    x: ((m.x - box.xmin) / (box.xmax - box.xmin)) * size,
    y: ((box.ymax - m.y) / (box.ymax - box.ymin)) * size,
  };
}

/** Mercator bounds of a slippy-map tile. */
export function tileMercBox(x: number, y: number, z: number): MercBox {
  const world = 2 * Math.PI * R;
  const size = world / 2 ** z;
  const xmin = -world / 2 + x * size;
  const ymax = world / 2 - y * size;
  return { xmin, ymin: ymax - size, xmax: xmin + size, ymax };
}

/** Ground feet per pixel for an image of `box` at `size` px, at latitude `lat`. */
export function feetPerPixel(box: MercBox, size: number, lat: number): number {
  const metersPerPx = ((box.xmax - box.xmin) / size) * Math.cos((lat * Math.PI) / 180);
  return metersPerPx * 3.28084;
}
