/**
 * Public GIS endpoints, in one place.
 *
 * Johnson County publishes its parcels, contours and aerials through ArcGIS
 * REST services that anyone can query. That covers the shop's home county at
 * survey quality: lot lines as recorded, 2025 aerials. Outside it, the USGS
 * National Map fills in with statewide imagery (lower resolution, no lot lines)
 * and 1 m lidar elevation, which covers all of Iowa.
 *
 * Adding a county is adding an entry to PARCEL_SOURCES with its parcel layer
 * and field names — nothing else in the app changes.
 */

import type { Bounds } from "../geo/geo";

export interface ParcelSource {
  county: string;
  /** Rough extent, used to decide whether to even ask. */
  extent: Bounds;
  /** ArcGIS MapServer/FeatureServer layer URL (no trailing /query). */
  layer: string;
  fields: {
    id: string;
    address: string;
    city?: string;
    areaSqFt?: string;
    propClass?: string;
    /** Field holding a link to the assessor's page for the parcel. */
    link?: string;
  };
  /** Higher-resolution aerial MapServer for this county, if any. */
  aerial?: string;
}

export const PARCEL_SOURCES: ParcelSource[] = [
  {
    county: "Johnson County, IA",
    extent: { south: 41.42, west: -91.84, north: 41.87, east: -91.36 },
    layer: "https://gis.johnsoncountyiowa.gov/arcgis/rest/services/PDS/MapServer/26",
    fields: {
      id: "PPN",
      address: "SiteAddress",
      city: "City",
      areaSqFt: "Shape_Area",
      propClass: "PropClass",
      link: "Assessors_Link",
    },
    aerial: "https://gis.johnsoncountyiowa.gov/arcgis/rest/services/Basemaps/2025_Aerials/MapServer",
  },
];

/** USGS National Map imagery — public domain, nationwide. */
export const USGS_IMAGERY = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer";

/** USGS Elevation Point Query Service — 3DEP lidar, 1 m in Iowa. */
export const EPQS = "https://epqs.nationalmap.gov/v1/json";

export function inExtent(lat: number, lng: number, e: Bounds): boolean {
  return lat >= e.south && lat <= e.north && lng >= e.west && lng <= e.east;
}

export function parcelSourceFor(lat: number, lng: number): ParcelSource | null {
  return PARCEL_SOURCES.find((s) => inExtent(lat, lng, s.extent)) ?? null;
}

export function aerialServiceFor(lat: number, lng: number): string {
  return parcelSourceFor(lat, lng)?.aerial ?? USGS_IMAGERY;
}
