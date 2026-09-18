/**
 * Supplier price sources for the scheduled catalog price check.
 *
 * Each source fetches one public page and extracts a price with a regex
 * anchored to the supplier's own product label — never an LLM, so a result
 * is either a confident match or nothing. A source throws rather than
 * guessing when its page doesn't match, so a wording change on the
 * supplier's site fails the job loudly instead of writing a wrong price.
 *
 * Menards was evaluated and dropped. menards.com returns a bot-detection
 * interstitial ("Pardon Our Interruption") to a plain fetch. Getting past
 * that is out of scope for this job, not a gap to route around — Menards
 * prices still have to be checked by hand.
 */

export interface PriceMatch {
  /** Catalog material name this price should be written to (owner-scoped). */
  materialName: string;
  category: string;
  unit: string;
  priceCents: number;
  supplier: string;
  supplierLocation: string;
  coverage: string;
  sourceUrl: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LandscapeEstimatePriceWatch/1.0)",
    },
  });
  if (!res.ok) {
    throw new Error(`${url} returned HTTP ${res.status}`);
  }
  return res.text();
}

/** Strip tags/scripts down to plain-ish text — enough for a label-anchored regex. */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

export async function fetchMasterYourLawnMulch(): Promise<PriceMatch> {
  const url = "https://www.masteryourlawn.com/bulk-mulch";
  const text = toText(await fetchText(url));

  // Anchored to the product's own label, not just any "$NN a cu yd" on the
  // page, so a second bulk product added later can't be mismatched to this
  // one. Tolerates a colon or dash (or neither) between label and price, and
  // "a"/"per", "yd"/"yds", with or without the period after "cu".
  const m = text.match(
    /Double Ground Premium Hardwood Mulch\s*\(Dyed Dark Chocolate\)\s*[:\-]?\s*\$(\d+(?:\.\d{2})?)\s*(?:a|per)\s*cu\.?\s*yds?/i
  );
  if (!m) {
    throw new Error(
      `Could not find the dyed-mulch price on ${url} — the page's wording ` +
        `likely changed. Check it by hand and update the regex in ` +
        `lib/price-watch/sources.ts.`
    );
  }

  const dollars = Number(m[1]);
  if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 500) {
    throw new Error(
      `Parsed an implausible mulch price ($${m[1]}/cu yd) from ${url} — refusing to apply it.`
    );
  }

  return {
    materialName: "Dyed mulch, dark chocolate (bulk)",
    category: "mulch",
    unit: "cu yd",
    priceCents: Math.round(dollars * 100),
    supplier: "Master Your Lawn (Turf Masters Lawn & Landscape)",
    supplierLocation: "Coralville/Iowa City, IA",
    coverage: "1 cu yd covers ~100 sq ft at 3 in depth",
    sourceUrl: url,
  };
}

/** Every source the scheduled job checks, run in order. */
export const PRICE_SOURCES = [fetchMasterYourLawnMulch];
