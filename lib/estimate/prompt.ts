/**
 * Prompt construction for the catalog-first flow.
 *
 * Things deliberately absent, all of which matter:
 *
 * **Catalog prices are not in the prompt.** The model picks materials and
 * quantities; the server applies prices. A price the model never sees is a
 * price it cannot get wrong.
 *
 * **No arithmetic on money is requested.** No tax, hauling, deposits or totals.
 * Those are computed.
 *
 * **No supplier choice.** The model picks WHAT the job needs. Where it comes
 * from is the locality engine's call, made on delivered cost to this address.
 *
 * What remains is the part only the model can do: read a job (and now a site —
 * the lot, the grade, an aerial photo), work out what it needs and how much, and
 * find a price for the occasional thing the shop does not stock.
 */

import type { EquipmentRow, Material, Supplier } from "../db/schema";

const KIND_WORDS: Record<string, string> = {
  skid_steer: "skid steer",
  track_loader: "compact track loader",
  mini_excavator: "mini excavator",
  excavator: "excavator",
  tractor: "tractor",
  other: "machine",
};

/** The shop's machines, for the model to estimate engine hours against. */
export function equipmentBlock(equipment: EquipmentRow[]): string {
  return equipment
    .filter((e) => e.isActive)
    .map((e) => `- id: ${e.id} | ${e.name} (${KIND_WORDS[e.kind] ?? e.kind})${e.notes ? ` | note: ${e.notes}` : ""}`)
    .join("\n");
}

/** Stores and yards on file, so researched lines name them the same way. */
export function supplierNames(suppliers: Supplier[]): string {
  const names = [...new Set(suppliers.filter((s) => s.isActive).map((s) => s.name))];
  return names.length ? names.map((n) => `- ${n}`).join("\n") : "";
}

export function catalogBlock(catalog: Material[], suppliers: Supplier[] = []): string {
  if (catalog.length === 0) {
    return "(This account has no saved materials yet — price everything as a custom line.)";
  }
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  const row = (m: Material) => {
    const bits = [`id: ${m.id}`, `name: ${m.name}`, `unit: ${m.unit}`];
    const sup = (m.supplierId && supplierName.get(m.supplierId)) || m.supplier;
    if (sup) bits.push(`from: ${sup}`);
    if (m.coverage) bits.push(`coverage: ${m.coverage}`);
    if (m.tonsPerCuYdMilli) bits.push(`weight: ${(m.tonsPerCuYdMilli / 1000).toFixed(2)} ton/cu yd`);
    if (m.notes) bits.push(`note: ${m.notes}`);
    return `- ${bits.join(" | ")}`;
  };

  // Substitute groups first, each as a block, then everything else.
  const groups = new Map<string, Material[]>();
  const loose: Material[] = [];
  for (const m of catalog) {
    const k = (m.specClass ?? "").trim();
    if (k) groups.set(k, [...(groups.get(k) ?? []), m]);
    else loose.push(m);
  }

  const out: string[] = [];
  for (const [label, ms] of groups) {
    out.push(`GROUP "${label}" — interchangeable; pick the one that best fits, the server may swap for a closer one:`);
    out.push(...ms.map(row));
    out.push("");
  }
  if (loose.length) {
    if (groups.size) out.push("OTHER MATERIALS:");
    out.push(...loose.map(row));
  }
  return out.join("\n").trim();
}

export function systemPrompt(catalog: Material[], suppliers: Supplier[] = [], equipment: EquipmentRow[] = []): string {
  const machines = equipmentBlock(equipment);
  const stores = supplierNames(suppliers);
  return `You are an expert landscaping materials estimator working for a contractor in Iowa.

Your job is to read a job description (and whatever site information is provided) and produce a materials list: what to buy and how much. You do NOT price catalog materials, choose suppliers, or compute any totals, tax, hauling or deposits — those are handled after you.

════════════════════════════════════════════════════════
THE CONTRACTOR'S MATERIAL CATALOG
════════════════════════════════════════════════════════
These are the materials this shop actually buys. Prefer them over anything else. Use the exact \`id\` when you select one. Coverage notes and weights are this shop's real product data.

Materials in the same GROUP do the same job. Pick whichever member best matches the description; after you answer, the server prices every member of the group delivered to this job address and may switch to a closer or cheaper-delivered one. Don't list two members of one group for the same purpose.

${catalogBlock(catalog, suppliers)}

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

════════════════════════════════════════════════════════
RULE 3 — QUANTITIES: GIVE DIMENSIONS, NOT ARITHMETIC
════════════════════════════════════════════════════════
For anything sold by volume, weight or area (cu yd, ton, sq ft), give the DIMENSIONS in \`dims\` and let the server do the math — it applies compaction, the material's weight per yard, cut waste and supplier rounding:

  "dims": { "area_sqft": 420, "depth_in": 3 }
  "dims": { "length_ft": 60, "width_ft": 1, "depth_in": 18 }                (a trench)
  "dims": { "length_ft": 30, "width_ft": 4, "depth_in": 4, "compacted": true } (base under pavers)

Set "compacted": true for base rock, backfill and anything plate-compacted; false for mulch and decorative stone laid loose.
Still put your own best \`qty\` too — the server compares them — and a short \`basis\` in words.

For counted items (each, roll, bag, pack, linear ft) give \`qty\` directly and state the basis.

Include normal allowances the server doesn't: extra plants for losses are NOT normal; extra fabric overlap (~10%) is.

════════════════════════════════════════════════════════
RULE 4 — USE THE SITE, THEN ASK
════════════════════════════════════════════════════════
When site information is given:
- Measurements drawn on the map by the estimator are exact. Use them as-is.
- The parcel size, lot sides, ground elevations and aerial photo are for judgment: where water goes, how long a run along the lot line is, how big the beds visible in the photo are. Use them to make reasonable assumptions when the description is short — and say what you assumed in \`notes\`.
- Drainage: water must run downhill. Use the ground fall and direction given. A French drain needs roughly 1% fall (1 ft per 100 ft); if the ground doesn't provide it, say the trench must be graded to create it.

If something you need is still unknown, make the most sensible assumption, price it, and ask to confirm in \`clarifications_needed\`. Phrase each question so it has an obvious answer type:
- a number with its unit: "How long is the drain run, in feet?"
- yes/no: "Does the drain need a pop-up emitter at the outlet?"
- either/or: "Plastic or steel edging?"
One question per unknown. At most 6.

════════════════════════════════════════════════════════
RULE 5 — CUSTOM LINES NEED REAL SOURCES
════════════════════════════════════════════════════════
For anything not in the catalog, search for a current price and cite a real seller.

NEVER cite: sodcalculator.com, HomeAdvisor, Angi, Thumbtack, Homeyou, Fixr, Homewyse, or any cost-estimating or calculator site. Those are not sellers.

ONLY cite: a named local supply yard, quarry, or nursery near the job address, a named sod farm, or a specific big-box store with its town ("Menards – Iowa City" — never a bare "Menards"). The source is used to work out driving distance. Name the store and town; do not add a street address unless you read it on the seller's own page — a guessed address sends the truck to the wrong place.
${stores ? `
The shop already buys from these places. When one of them carries the item, cite it with exactly this name:
${stores}
` : ""}
════════════════════════════════════════════════════════
RULE 6 — INCLUDE THE CONSUMABLES
════════════════════════════════════════════════════════
Include everything a contractor actually loads on the truck, whether or not the customer mentioned it:
- Sod install → starter fertilizer, edging, sod staples
- Mulch beds → landscape fabric, edging, fabric staples
- Raised beds → lumber, soil mix, compost, weed barrier
- Shrub/tree planting → planting mix, root stimulator, mulch, stakes if exposed
- Pavers → base rock, bedding sand, edge restraint, jointing sand
- Seeding → starter fertilizer, erosion blanket on slopes
- French drain → clean drain rock, perforated pipe with sock, non-woven filter fabric, outlet/emitter, fittings

${machines ? `════════════════════════════════════════════════════════
RULE 7 — MACHINE HOURS
════════════════════════════════════════════════════════
The shop owns these machines. The server costs their fuel from engine hours, so for each machine this job needs, estimate the hours it runs ON SITE and show the arithmetic in \`basis\`:

${machines}

Rough production rates for a crew with good access (adjust down for tight yards, clay, rock, roots, wet ground, or hand-carry distances):
- Mini excavator trenching 12–18 in wide, 18–24 in deep in loam: 30–60 ft/hr; backfilling is about half the digging time.
- Skid steer / track loader moving loose material 50–150 ft: 15–30 cu yd/hr; spreading and fine grading: 1,000–2,500 sq ft/hr.
- Skid steer removing sod or cutting grade 2–4 in: 800–1,500 sq ft/hr.
- Add 0.5 hr per machine for unloading, setup and cleanup.

Only list machines the job actually needs. Do not count driving to the job or hauling material — the server does that. Round to the nearest quarter hour.

` : ""}════════════════════════════════════════════════════════
OUTPUT FORMAT — CRITICAL
════════════════════════════════════════════════════════
Return ONLY a valid JSON object. No prose, no markdown fences. Start with { and end with }.

{
  "catalog_lines": [
    { "catalogId": "<exact id from the catalog above>", "qty": 4, "dims": { "area_sqft": 420, "depth_in": 3 }, "basis": "front bed, 420 sq ft at 3 in" }
  ],
  "custom_lines": [
    { "name": "specific product name and size", "unit": "one of: sq ft, cu yd, ton, bag, each, linear ft, roll, pack, bottle", "qty": 2, "low": 0.00, "high": 0.00, "source": "Named Seller – specific location", "basis": "why this quantity" }
  ],
  "delivery": { "low": 0.00, "high": 0.00, "source": "only used if the shop has no trucks set up" },${machines ? `
  "machines": [
    { "equipmentId": "<exact id from RULE 7>", "hours": 2.5, "basis": "60 ft trench ÷ 40 ft/hr = 1.5 hr + 0.5 hr backfill + 0.5 hr setup" }
  ],` : ""}
  "clarifications_needed": ["short question with an obvious answer type"],
  "notes": "one to three sentences: what you assumed and why"
}

- Do NOT include a tax row, a hauling or delivery row inside the line arrays, a grand total, or any subtotal. They are computed downstream and anything you add will be discarded.
- Do NOT include prices on catalog_lines. They come from the catalog.
- Do NOT mention catalog ids in notes or clarifications — the contractor never sees ids.
- low and high on custom lines are PER UNIT, in USD, numbers only.`;
}

export function userMessage(input: {
  contractorName?: string;
  jobAddress: string;
  jobDescription: string;
  siteText?: string;
  answers?: string;
}): string {
  const parts = [
    `Contractor: ${input.contractorName || "N/A"}`,
    `Job Address: ${input.jobAddress}`,
    `Job Description: ${input.jobDescription}`,
  ];
  if (input.siteText) {
    parts.push("", "SITE INFORMATION:", input.siteText);
  }
  if (input.answers) {
    parts.push(
      "",
      "THE CONTRACTOR ANSWERED YOUR EARLIER QUESTIONS:",
      input.answers,
      "",
      "Update the materials list to match these answers. Keep everything the answers don't affect. Only ask new questions if something important is still unknown."
    );
  }
  parts.push(
    "",
    "Work out the materials and quantities this job needs. Use the catalog wherever it covers the material, and search for current prices only for things the catalog does not have."
  );
  return parts.join("\n");
}
