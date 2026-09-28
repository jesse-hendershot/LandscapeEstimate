/**
 * Client-side shapes of what the estimate API returns. Types only — importing
 * these pulls no server code into the browser bundle.
 */

import type { HaulDetail } from "@/lib/estimate/locality";
import type { GateResult, LineAlternative, LineItem } from "@/lib/estimate/schema";
import type { MapMeasurement, SiteInfo } from "../SiteMap";

export type { HaulDetail, LineAlternative, LineItem, MapMeasurement, SiteInfo };

export interface SiteSummary {
  job: { lat: number; lng: number } | null;
  matchedAddress: string | null;
  parcel: SiteInfo["parcel"];
  grade: SiteInfo["grade"];
  measurements: MapMeasurement[];
  hadImage?: boolean;
}

export interface EstimateData {
  id: string | null;
  runId?: string | null;
  createdAt?: string;
  contractorName?: string;
  jobAddress?: string;
  jobDescription?: string;
  line_items: LineItem[];
  original_items?: LineItem[];
  total_low: number;
  total_high: number;
  clarifications_needed: string[];
  notes: string;
  verification?: { passed?: boolean; repaired?: boolean; gates?: GateResult[]; warnings?: GateResult[] } | unknown;
  haul: HaulDetail | null;
  site: SiteSummary | null | unknown;
  tax: { ratePct: number; haul: boolean; deposits: boolean };
  markupPct: number;
  trucksForJob: number;
  warnings: string[];
  fieldTest?: {
    handTotal: number | null;
    handMinutes: number | null;
    appSeconds: number | null;
    actualTotal: number | null;
    fieldNotes: string;
  };
  edited?: boolean;
}

export interface SettingsData {
  displayName: string;
  companyName: string;
  defaultMarkupPct: number;
  taxRatePct: number;
  taxHaul: boolean;
  taxDeposits: boolean;
  shopAddress: string;
  shopLocated: boolean;
  dieselOverride: number;
  gasOverride: number;
  offroadOverride: number;
  avgMph: number;
  loadMinutes: number;
  pickupStopMinutes: number;
  trucksPerJob: number;
  defaultHaulMiles: number;
}
