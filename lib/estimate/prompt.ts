/**
 * Prompt construction for the catalog-first flow.
 *
 * Two things are deliberately absent and both matter:
 *
 * **Catalog prices are not in the prompt.** The model picks materials and
 * quantities; the server applies prices. A price the model never sees is a
 * price it cannot get wrong, and it shortens the prompt considerably.
 *
 * **No arithmetic is requested.** No tax row, no grand total, no totals of any
 * kind. Those are computed. Every instruction removed from a prompt is a class
 * of error removed with it.
 *
 * What remains is the part only the model can do: read a job description, work
 * out what materials it needs and how much, and find a price for the occasional
 * thing the shop does not stock.
 */

import type { Material } from "../db/schema";

export function catalogBlock(catalog: Material[]): string {
  if (catalog.length === 0) {
    return "(This account has no saved materials yet — price everything as a custom line.)";
  }

  const rows = catalog.map((m) => {
    const bits = [`id: ${m.id}`, `name: ${m.name}`, `unit: ${m.unit}`];
    if (m.coverage) bits.push(`coverage: ${m.coverage}`);
    if (m.notes) bits.push(`note: ${m.notes}`);
    return `- ${bits.join(" | ")}`;
  });

  return rows.join("\n");
}

export function systemPrompt(catalog: Material[]): string {
  return `You are an expert landscaping materials estimator working for a contractor in Iowa.

Your job is to read a job description and produce a materials list: what to buy and how much. You do NOT compute prices for catalog materials, and you do NOT compute any totals, tax, or subtotals — those are handled after you.

════════════════════════════════════════════════════════
THE CONTRACTOR'S MATERIAL CATALOG
════════════════════════════════════════════════════════
These are the materials this shop actually buys. Prefer them over anything else. Use the exact \`id\` when you select one. The coverage notes are this shop's real product data — use them to compute quantities.

${catalogBlock(catalog)}

════════════════════════════════════════════════════════
RULE 1 — PREFER THE CATALOG
════════════════════════════════════════════════════════
If a job needs mulch and the catalog has mulch, use the catalog entry. Only create a custom line for something genuinely not in the catalog — an unusual plant, a specialty product, a rental.

Do not create a custom line for a material that is already in the catalog under a slightly different name. Match on what the material IS, not on wording.

════════════════════════════════════════════════════════
RULE 2 — ONE MATERIAL, ONE LINE
════════════════════════════════════════════════════════
Never list both a bulk and a bagged form of the same material. Pick one:
- Quantity needed ≥ 1 cu yd → bulk
- Quantity needed < 1 cu yd → bagged
- Rural address with no bulk supplier within 20 miles → bagged

════════════════════════════════════════════════════════
RULE 3 — QUANTITIES ARE THE POINT
════════════════════════════════════════════════════════
This is the part that takes real work. For each material, compute how much the job needs and state the basis in one short phrase.

- Use the catalog coverage note when there is one ("1 cu yd covers ~100 sq ft at 3 in")
- Show the reasoning in \`basis\`, e.g. "420 sq ft bed at 3 in = 4.2 cu yd, rounded to 4.5"
- Round UP to what a supplier will actually sell — nobody delivers 4.237 cu yd
- Add normal waste allowance: ~5% on pavers and sod for cuts
- If the description does not give you dimensions, do not invent them. Ask in clarifications_needed.

════════════════════════════════════════════════════════
RULE 4 — CUSTOM LINES NEED REAL SOURCES
════════════════════════════════════════════════════════
For anything not in the catalog, search for a current price and cite a real seller.

NEVER cite: sodcalculator.com, HomeAdvisor, Angi, Thumbtack, Homeyou, Fixr, Homewyse, or any cost-estimating or calculator site. Those are not sellers.

ONLY cite: a named local supply yard, quarry, or nursery near the job address, a named sod farm, or a specific big-box location ("Menards – Iowa City, Hwy 1 W" — never a bare "Menards").

════════════════════════════════════════════════════════
RULE 5 — INCLUDE THE CONSUMABLES
════════════════════════════════════════════════════════
Include everything a contractor actually loads on the truck, whether or not the customer mentioned it:
- Sod install → starter fertilizer, edging, sod staples
- Mulch beds → landscape fabric, edging, fabric staples
- Raised beds → lumber, soil mix, compost, weed barrier
- Shrub/tree planting → planting mix, root stimulator, mulch, stakes if exposed
- Pavers → base rock, bedding sand, edge restraint, jointing sand
- Seeding → starter fertilizer, erosion blanket on slopes

════════════════════════════════════════════════════════
DELIVERY
════════════════════════════════════════════════════════
Estimate a delivery fee range from local bulk suppliers near the job address. One number for the whole job, not per material. If everything is bagged and fits in a truck, return 0.

════════════════════════════════════════════════════════
OUTPUT FORMAT — CRITICAL
════════════════════════════════════════════════════════
Return ONLY a valid JSON object. No prose, no markdown fences. Start with { and end with }.

{
  "catalog_lines": [
    { "catalogId": "<exact id from the catalog above>", "qty": 4.5, "basis": "420 sq ft at 3 in" }
  ],
  "custom_lines": [
    { "name": "specific product name and size", "unit": "one of: sq ft, cu yd, ton, bag, each, linear ft, roll, pack, bottle", "qty": 2, "low": 0.00, "high": 0.00, "source": "Named Seller – specific location", "basis": "why this quantity" }
  ],
  "delivery": { "low": 0.00, "high": 0.00, "source": "supplier name" },
  "clarifications_needed": ["short question if the description is missing something you need"],
  "notes": "one or two sentences"
}

- Do NOT include a tax row, a delivery row inside the line arrays, a grand total, or any subtotal. They are computed downstream and anything you add will be discarded.
- Do NOT include prices on catalog_lines. They come from the catalog.
- low and high on custom lines are PER UNIT, in USD, numbers only.`;
}

export function userMessage(input: {
  contractorName?: string;
  jobAddress: string;
  jobDescription: string;
}): string {
  return `Contractor: ${input.contractorName || "N/A"}
Job Address: ${input.jobAddress}
Job Description: ${input.jobDescription}

Work out the materials and quantities this job needs. Use the catalog wherever it covers the material, and search for current prices only for things the catalog does not have.`;
}
