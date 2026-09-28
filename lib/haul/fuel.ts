/**
 * Fuel prices for the haul and machine math: road diesel, gasoline (a gas
 * pickup's miles), and off-road diesel (the machines).
 *
 * Source of truth is the EIA's weekly Midwest (PADD 2) No. 2 diesel retail
 * price, series EMD_EPD2D_PTE_R20_DPG. It's published every Monday for the
 * week, and it moves: $5.26 the first week of August 2026, $6.68 by
 * September 21. A haul estimate using last month's diesel is wrong by exactly
 * the kind of amount the shop cares about, which is why this refreshes itself.
 *
 * Two ways in:
 *   - EIA_API_KEY set: the official v2 API (free key from eia.gov/opendata).
 *   - No key: the same number from EIA's public history page, parsed out of
 *     the table. Fragile in principle, so it's the fallback, and the parser
 *     returns null rather than guessing if the table ever changes shape.
 *
 * A shop that buys fuel on contract can pin its own price in Settings, which
 * overrides both. Gasoline works the same way from its own EIA series. Dyed
 * off-road diesel has no public weekly price, so it's road diesel less the
 * road taxes it doesn't pay, unless the shop enters what it actually pays.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import { fuelPrices, type Profile } from "../db/schema";
import { fetchJson, fetchWithTimeout } from "../net";

export const DIESEL_SERIES = "EMD_EPD2D_PTE_R20_DPG";
/** Weekly Midwest regular gasoline, all formulations. Same page layout as diesel. */
export const GAS_SERIES = "EMM_EPMR_PTE_R20_DPG";
const historyUrl = (series: string) => `https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=${series}&f=W`;

/** Used only if EIA has never been reachable. Midwest retail, week of 2026-09-21. */
export const FALLBACK_DIESEL_CENTS = 668;
export const FALLBACK_GAS_CENTS = 439;

/**
 * Road taxes that dyed off-road diesel doesn't carry, cents per gallon:
 * federal 24.4 plus Iowa 32.5 (unchanged July 1, 2026). Off-road diesel is
 * estimated as road diesel minus these unless the shop enters what it pays.
 */
export const ROAD_TAX_CENTS = 57;

export interface DieselPrice {
  centsPerGal: number;
  period: string | null;
  source: "manual" | "eia" | "eia-cached" | "fallback" | "derived";
  label: string;
}

/** Any fuel's weekly price; same shape as diesel's. */
export type FuelPrice = DieselPrice;

export type FuelKind = "diesel" | "gas" | "offroad";

export interface FuelPrices {
  diesel: FuelPrice;
  gas: FuelPrice;
  offroad: FuelPrice;
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/**
 * Latest week out of EIA's history table. Rows look like
 *   <td class="B6">&nbsp;&nbsp;2026-Sep</td> <td class="B5">09/07&nbsp;</td>
 *   <td class="B3">5.946&nbsp;&nbsp;&nbsp;</td> ...
 */
export function parseEiaHistoryHtml(html: string): { period: string; dollars: number } | null {
  const rowRe = /(\d{4})-([A-Z][a-z]{2})\s*<\/td>([\s\S]*?)<\/tr>/g;
  const cellRe = /class="B5">\s*(\d{2})\/(\d{2})(?:&nbsp;|\s)*<\/td>\s*<td class="B3">\s*([\d.]+)/g;
  let latest: { period: string; dollars: number } | null = null;

  for (const row of html.matchAll(rowRe)) {
    const year = row[1];
    if (!MONTHS[row[2]]) continue;
    for (const cell of row[3].matchAll(cellRe)) {
      const dollars = parseFloat(cell[3]);
      if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 20) continue;
      // A December row can hold a first-week-of-January date; the cell's own
      // month wins over the row's.
      const period = `${year}-${cell[1]}-${cell[2]}`;
      if (!latest || period > latest.period) latest = { period, dollars };
    }
  }
  return latest;
}

/** EIA API v2 response, either the seriesid route or the data route. */
export function parseEiaApi(json: unknown): { period: string; dollars: number } | null {
  const data = (json as { response?: { data?: Record<string, unknown>[] } })?.response?.data;
  if (!Array.isArray(data)) return null;
  let latest: { period: string; dollars: number } | null = null;
  for (const d of data) {
    const period = String(d.period ?? "");
    const dollars = parseFloat(String(d.value ?? d.price ?? ""));
    if (!period || !Number.isFinite(dollars) || dollars <= 0 || dollars > 20) continue;
    if (!latest || period > latest.period) latest = { period, dollars };
  }
  return latest;
}

async function fetchLatest(series: string): Promise<{ period: string; dollars: number } | null> {
  const key = process.env.EIA_API_KEY;
  if (key) {
    try {
      const url =
        `https://api.eia.gov/v2/seriesid/PET.${series}.W?` +
        new URLSearchParams({ api_key: key, length: "5", "sort[0][column]": "period", "sort[0][direction]": "desc" });
      const r = parseEiaApi(await fetchJson(url, { timeoutMs: 8000 }));
      if (r) return r;
    } catch {
      // fall through to the page
    }
  }
  const res = await fetchWithTimeout(historyUrl(series), { timeoutMs: 8000 });
  if (!res.ok) return null;
  return parseEiaHistoryHtml(await res.text());
}

const REFRESH_AFTER_MS = 12 * 3600 * 1000;

const NOUN: Record<string, string> = { [DIESEL_SERIES]: "Midwest diesel", [GAS_SERIES]: "Midwest regular gas" };

/** This week's EIA price for one series, from the cache when it's fresh. */
async function weeklyPrice(series: string, overrideCents: number, fallbackCents: number): Promise<FuelPrice> {
  if (overrideCents > 0) {
    return {
      centsPerGal: overrideCents,
      period: null,
      source: "manual",
      label: `$${(overrideCents / 100).toFixed(2)}/gal (your setting)`,
    };
  }
  const noun = NOUN[series] ?? "fuel";

  let row: { centsPerGal: number; period: string; fetchedAt: Date } | undefined;
  try {
    [row] = await db
      .select({ centsPerGal: fuelPrices.centsPerGal, period: fuelPrices.period, fetchedAt: fuelPrices.fetchedAt })
      .from(fuelPrices)
      .where(eq(fuelPrices.series, series))
      .orderBy(desc(fuelPrices.period))
      .limit(1);
  } catch {
    row = undefined;
  }

  const periodAgeDays = row ? (Date.now() - new Date(row.period).getTime()) / 86_400_000 : Infinity;
  const checkedRecently = row ? Date.now() - row.fetchedAt.getTime() < REFRESH_AFTER_MS : false;

  // A week-old period means a newer one is probably out. Don't re-check more
  // than twice a day either way.
  if (!row || (periodAgeDays > 7 && !checkedRecently)) {
    try {
      const latest = await fetchLatest(series);
      if (latest) {
        const cents = Math.round(latest.dollars * 100);
        await db
          .insert(fuelPrices)
          .values({ series, period: latest.period, centsPerGal: cents, source: "eia" })
          .onConflictDoUpdate({
            target: [fuelPrices.series, fuelPrices.period],
            set: { centsPerGal: cents, fetchedAt: new Date() },
          });
        return {
          centsPerGal: cents,
          period: latest.period,
          source: "eia",
          label: `$${latest.dollars.toFixed(2)}/gal — EIA ${noun}, week of ${latest.period}`,
        };
      }
    } catch {
      // keep whatever we had
    }
    if (row) {
      // Touch fetchedAt so a dead EIA isn't retried on every estimate.
      try {
        await db
          .update(fuelPrices)
          .set({ fetchedAt: new Date() })
          .where(and(eq(fuelPrices.series, series), eq(fuelPrices.period, row.period)));
      } catch {
        // ignore
      }
    }
  }

  if (row) {
    return {
      centsPerGal: row.centsPerGal,
      period: row.period,
      source: "eia-cached",
      label: `$${(row.centsPerGal / 100).toFixed(2)}/gal — EIA ${noun}, week of ${row.period}`,
    };
  }

  return {
    centsPerGal: fallbackCents,
    period: null,
    source: "fallback",
    label: `$${(fallbackCents / 100).toFixed(2)}/gal (couldn't reach EIA — set your own price in Settings)`,
  };
}

export async function currentDiesel(profile: Pick<Profile, "dieselOverrideCents">): Promise<DieselPrice> {
  return weeklyPrice(DIESEL_SERIES, profile.dieselOverrideCents, FALLBACK_DIESEL_CENTS);
}

/** Off-road diesel: the shop's own price, or road diesel less the road taxes. */
export function offroadFrom(diesel: FuelPrice, overrideCents: number): FuelPrice {
  if (overrideCents > 0) {
    return { centsPerGal: overrideCents, period: null, source: "manual", label: `$${(overrideCents / 100).toFixed(2)}/gal (your setting)` };
  }
  const cents = Math.max(0, diesel.centsPerGal - ROAD_TAX_CENTS);
  return {
    centsPerGal: cents,
    period: diesel.period,
    source: "derived",
    label: `$${(cents / 100).toFixed(2)}/gal — road diesel less 24.4¢ federal + 32.5¢ Iowa road tax`,
  };
}

/** Diesel, gas and off-road diesel for this week, honoring the shop's own prices. */
export async function currentFuel(
  profile: Pick<Profile, "dieselOverrideCents" | "gasOverrideCents" | "offroadOverrideCents">
): Promise<FuelPrices> {
  const [diesel, gas] = await Promise.all([
    currentDiesel(profile),
    weeklyPrice(GAS_SERIES, profile.gasOverrideCents ?? 0, FALLBACK_GAS_CENTS),
  ]);
  return { diesel, gas, offroad: offroadFrom(diesel, profile.offroadOverrideCents ?? 0) };
}

export const centsFor = (prices: FuelPrices, kind: string): number =>
  (kind === "gas" ? prices.gas : kind === "offroad" ? prices.offroad : prices.diesel).centsPerGal;
