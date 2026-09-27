/**
 * Shop settings: the profile row, as the settings screen sees it.
 *
 * Money and rates cross the wire as dollars and percents; the database holds
 * cents and basis points. Converted here and nowhere else.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "./db";
import { profiles, type Profile } from "./db/schema";
import { geocodeAddress } from "./geo/geocode";
import { toCents, fromCents } from "./money";

export function presentSettings(p: Profile) {
  return {
    displayName: p.displayName,
    companyName: p.companyName,
    defaultMarkupPct: p.defaultMarkupBps / 100,
    taxRatePct: p.taxRateBps / 100,
    taxHaul: p.taxHaul,
    taxDeposits: p.taxDeposits,
    shopAddress: p.shopAddress,
    shopLocated: p.shopLat !== null && p.shopLng !== null,
    shopLat: p.shopLat,
    shopLng: p.shopLng,
    dieselOverride: fromCents(p.dieselOverrideCents),
    avgMph: p.avgMph,
    loadMinutes: p.loadMinutes,
    pickupStopMinutes: p.pickupStopMinutes,
    trucksPerJob: p.trucksPerJob,
    defaultHaulMiles: p.defaultHaulMiles,
  };
}

export type Settings = ReturnType<typeof presentSettings>;

export const settingsPatchSchema = z
  .object({
    displayName: z.string().trim().max(120),
    companyName: z.string().trim().max(160),
    defaultMarkupPct: z.number().min(0).max(300),
    taxRatePct: z.number().min(0).max(20),
    taxHaul: z.boolean(),
    taxDeposits: z.boolean(),
    shopAddress: z.string().trim().max(240),
    dieselOverride: z.number().min(0).max(20),
    avgMph: z.number().int().min(10).max(70),
    loadMinutes: z.number().int().min(0).max(180),
    pickupStopMinutes: z.number().int().min(0).max(180),
    trucksPerJob: z.number().int().min(1).max(10),
    defaultHaulMiles: z.number().int().min(0).max(200),
  })
  .partial();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export async function updateSettings(
  profile: Profile,
  patch: SettingsPatch
): Promise<{ profile: Profile; warning: string | null }> {
  const next: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date() };
  let warning: string | null = null;

  if (patch.displayName !== undefined) next.displayName = patch.displayName;
  if (patch.companyName !== undefined) next.companyName = patch.companyName;
  if (patch.defaultMarkupPct !== undefined) next.defaultMarkupBps = Math.round(patch.defaultMarkupPct * 100);
  if (patch.taxRatePct !== undefined) next.taxRateBps = Math.round(patch.taxRatePct * 100);
  if (patch.taxHaul !== undefined) next.taxHaul = patch.taxHaul;
  if (patch.taxDeposits !== undefined) next.taxDeposits = patch.taxDeposits;
  if (patch.dieselOverride !== undefined) next.dieselOverrideCents = toCents(patch.dieselOverride);
  if (patch.avgMph !== undefined) next.avgMph = patch.avgMph;
  if (patch.loadMinutes !== undefined) next.loadMinutes = patch.loadMinutes;
  if (patch.pickupStopMinutes !== undefined) next.pickupStopMinutes = patch.pickupStopMinutes;
  if (patch.trucksPerJob !== undefined) next.trucksPerJob = patch.trucksPerJob;
  if (patch.defaultHaulMiles !== undefined) next.defaultHaulMiles = patch.defaultHaulMiles;

  if (patch.shopAddress !== undefined && patch.shopAddress !== profile.shopAddress) {
    next.shopAddress = patch.shopAddress;
    if (patch.shopAddress) {
      const g = await geocodeAddress(patch.shopAddress, "Iowa");
      next.shopLat = g?.lat ?? null;
      next.shopLng = g?.lng ?? null;
      if (!g) warning = "Couldn't find that shop address on the map — check the spelling and include the town.";
    } else {
      next.shopLat = null;
      next.shopLng = null;
    }
  }

  const [row] = await db.update(profiles).set(next).where(eq(profiles.id, profile.id)).returning();
  return { profile: row, warning };
}
