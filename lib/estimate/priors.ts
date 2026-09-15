/**
 * Material priors — what makes the bounds gate mechanical instead of a vibes
 * check.
 *
 * CALIBRATE THESE. The bands are seed values for the Iowa City / Cedar Rapids
 * market and they are the weakest part of this layer as shipped. Every band
 * tightened to a number actually paid at a supplier makes the gate catch more
 * real errors. Four years of invoices beats anything estimated from the web.
 *
 * Bands are per-unit SUPPLIER price before contractor markup, in USD.
 *
 * An unmatched material is NOT a failure. This app estimates arbitrary jobs, so
 * the bounds gate skips anything it has no prior for rather than blocking a
 * legitimate line. Coverage grows as priors are added.
 */

import type { Unit } from "./schema";

export type MaterialClass =
  | "bulk_loose"   // sold by the cubic yard in bulk
  | "aggregate"    // sold by the ton in bulk
  | "sod"
  | "plant"
  | "edging"
  | "sheet_good"
  | "hardware"
  | "amendment"    // fertilizer, seed, stimulator
  | "paver";

export interface MaterialPrior {
  key: string;
  label: string;
  cls: MaterialClass;
  /** Matched against the model's material string, first hit wins. */
  patterns: RegExp[];
  /** Units this material may legitimately be sold in. */
  units: Unit[];
  /** Per-unit price band. A unit absent here is allowed but unbounded. */
  bands: Partial<Record<Unit, [number, number]>>;
}

export const PRIORS: MaterialPrior[] = [
  {
    key: "dyed_mulch",
    label: "Dyed mulch",
    cls: "bulk_loose",
    patterns: [/\b(dyed|black|brown|red|colored)\b.*\bmulch\b/i, /\bmulch\b.*\b(dyed|colored)\b/i],
    units: ["cu yd", "bag"],
    bands: { "cu yd": [32, 70], bag: [3.0, 8.5] },
  },
  {
    key: "hardwood_mulch",
    label: "Hardwood mulch",
    cls: "bulk_loose",
    patterns: [/\b(hardwood|shredded|bark|natural|cedar|cypress)\b.*\bmulch\b/i, /\bmulch\b/i],
    units: ["cu yd", "bag"],
    bands: { "cu yd": [26, 58], bag: [2.5, 7.5] },
  },
  {
    key: "compost",
    label: "Compost",
    cls: "bulk_loose",
    patterns: [/\bcompost\b/i, /\bmushroom soil\b/i],
    units: ["cu yd", "bag"],
    bands: { "cu yd": [28, 64], bag: [4.0, 13.0] },
  },
  {
    key: "planting_mix",
    label: "Planting / garden mix",
    cls: "bulk_loose",
    patterns: [/\b(garden|planting|bed|potting|raised bed)\s*(mix|soil|blend)\b/i, /\bsoil blend\b/i],
    units: ["cu yd", "bag"],
    bands: { "cu yd": [26, 60], bag: [4.0, 15.0] },
  },
  {
    key: "topsoil",
    label: "Screened topsoil",
    cls: "bulk_loose",
    patterns: [/\btopsoil\b/i, /\bblack dirt\b/i, /\bscreened soil\b/i],
    units: ["cu yd", "bag"],
    bands: { "cu yd": [20, 48], bag: [2.0, 7.0] },
  },
  {
    key: "fill_dirt",
    label: "Fill dirt",
    cls: "bulk_loose",
    patterns: [/\b(fill dirt|clean fill|structural fill|backfill)\b/i],
    units: ["cu yd"],
    bands: { "cu yd": [8, 28] },
  },

  {
    key: "crushed_limestone",
    label: "Crushed limestone / road rock",
    cls: "aggregate",
    patterns: [/\b(road rock|crushed limestone|ag lime|road stone|class a)\b/i, /\blimestone\b/i],
    units: ["ton", "cu yd"],
    bands: { ton: [16, 42], "cu yd": [22, 58] },
  },
  {
    key: "clean_stone",
    label: "Clean / drainage stone",
    cls: "aggregate",
    patterns: [/\b(clean stone|washed stone|drainage (stone|rock)|clean rock|\d+\s*inch clean)\b/i],
    units: ["ton", "cu yd"],
    bands: { ton: [22, 52], "cu yd": [30, 70] },
  },
  {
    key: "pea_gravel",
    label: "Pea gravel",
    cls: "aggregate",
    patterns: [/\bpea\s*(gravel|rock|stone)\b/i],
    units: ["ton", "cu yd"],
    bands: { ton: [30, 74], "cu yd": [40, 98] },
  },
  {
    key: "river_rock",
    label: "River rock",
    cls: "aggregate",
    patterns: [/\b(river\s*(rock|stone)|decorative rock|cobble)\b/i],
    units: ["ton", "cu yd"],
    bands: { ton: [42, 105], "cu yd": [56, 140] },
  },
  {
    key: "sand",
    label: "Sand",
    cls: "aggregate",
    patterns: [/\b(masonry|leveling|bedding|concrete|torpedo|play|paver)\s*sand\b/i, /\bsand\b/i],
    units: ["ton", "cu yd", "bag"],
    bands: { ton: [18, 48], "cu yd": [24, 62], bag: [3.0, 10.0] },
  },
  {
    key: "jointing_sand",
    label: "Polymeric / jointing sand",
    cls: "hardware",
    patterns: [/\b(polymeric|jointing|joint(ing)? stabilizing)\s*sand\b/i],
    units: ["bag"],
    bands: { bag: [18, 58] },
  },

  {
    key: "sod",
    label: "Sod",
    cls: "sod",
    patterns: [/\bsod\b/i, /\b(bluegrass|fescue|zoysia)\b.*\b(turf|sod)\b/i],
    units: ["sq ft"],
    bands: { "sq ft": [0.28, 0.95] },
  },

  {
    key: "paver",
    label: "Paver",
    cls: "paver",
    patterns: [/\b(paver|holland stone|brick paver|patio stone|flagstone)\b/i],
    units: ["sq ft", "each"],
    bands: { "sq ft": [1.9, 8.5], each: [0.8, 12.0] },
  },
  {
    key: "retaining_block",
    label: "Retaining wall block",
    cls: "paver",
    patterns: [/\b(retaining|wall)\s*(wall\s*)?block\b/i, /\b(versa[- ]?lok|keystone|segmental)\b/i],
    units: ["each", "sq ft"],
    bands: { each: [2.3, 14.0], "sq ft": [8.0, 34.0] },
  },

  {
    key: "edging",
    label: "Landscape edging",
    cls: "edging",
    patterns: [/\bedging\b/i, /\b(border|edge)\s*(restraint|strip)\b/i],
    units: ["linear ft", "each"],
    bands: { "linear ft": [0.9, 5.2], each: [8.0, 60.0] },
  },
  {
    key: "paver_restraint",
    label: "Paver edge restraint",
    cls: "edging",
    patterns: [/\b(edge|paver)\s*restraint\b/i],
    units: ["linear ft"],
    bands: { "linear ft": [1.2, 5.5] },
  },

  {
    key: "landscape_fabric",
    label: "Landscape fabric / weed barrier",
    cls: "sheet_good",
    patterns: [/\b(landscape fabric|weed (barrier|fabric|block)|geotextile)\b/i],
    units: ["roll", "sq ft"],
    bands: { roll: [14, 150], "sq ft": [0.05, 0.45] },
  },
  {
    key: "erosion_blanket",
    label: "Straw / erosion blanket",
    cls: "sheet_good",
    patterns: [/\b(erosion (blanket|control)|straw (blanket|mat))\b/i],
    units: ["roll", "each"],
    bands: { roll: [25, 165], each: [25, 165] },
  },
  {
    key: "straw_bale",
    label: "Straw bale",
    cls: "sheet_good",
    patterns: [/\bstraw\b(?!.*blanket)/i, /\bbale\b/i],
    units: ["each", "bag"],
    bands: { each: [5, 18], bag: [5, 18] },
  },

  {
    key: "staples",
    label: "Staples / hardware pack",
    cls: "hardware",
    patterns: [/\b(staple|pin|anchor)s?\b/i],
    units: ["pack"],
    bands: { pack: [5, 34] },
  },
  {
    key: "stake_kit",
    label: "Tree stake / guying kit",
    cls: "hardware",
    patterns: [/\b(tree )?(stake|guy(ing)?)\s*(kit|set)?\b/i],
    units: ["each", "pack"],
    bands: { each: [7, 42], pack: [10, 55] },
  },
  {
    key: "lumber",
    label: "Dimensional lumber / timber",
    cls: "hardware",
    patterns: [/\b(lumber|timber|\d+x\d+|landscape tie)\b/i],
    units: ["linear ft", "each"],
    bands: { "linear ft": [1.1, 9.5], each: [8, 75] },
  },

  {
    key: "starter_fertilizer",
    label: "Starter fertilizer",
    cls: "amendment",
    patterns: [/\b(starter )?fertilizer\b/i, /\bstarter\b.*\bfeed\b/i],
    units: ["bag"],
    bands: { bag: [15, 62] },
  },
  {
    key: "grass_seed",
    label: "Grass seed",
    cls: "amendment",
    patterns: [/\b(grass |lawn )?seed\b/i],
    units: ["bag"],
    bands: { bag: [28, 185] },
  },
  {
    key: "root_stimulator",
    label: "Root stimulator / liquid concentrate",
    cls: "amendment",
    patterns: [/\b(root stimulator|starter solution|herbicide|concentrate)\b/i],
    units: ["bottle"],
    bands: { bottle: [7, 45] },
  },

  {
    key: "tree",
    label: "Tree",
    cls: "plant",
    patterns: [/\btree\b(?!.*(stake|guy|kit|ring))/i, /\b(maple|oak|linden|birch|spruce|pine)\b/i],
    units: ["each"],
    bands: { each: [70, 750] },
  },
  {
    key: "shrub",
    label: "Shrub",
    cls: "plant",
    patterns: [/\b(shrub|bush|hydrangea|boxwood|arborvitae|juniper|spirea|viburnum)\b/i],
    units: ["each"],
    bands: { each: [14, 110] },
  },
  {
    key: "perennial",
    label: "Perennial / annual",
    cls: "plant",
    patterns: [/\b(perennial|annual|hosta|daylily|ornamental grass|flat of)\b/i],
    units: ["each"],
    bands: { each: [4, 34] },
  },
];

/** Delivery is not a material but it has a plausible range worth checking. */
export const DELIVERY_BAND: [number, number] = [45, 450];

export function matchPrior(material: string): MaterialPrior | null {
  if (!material) return null;
  for (const p of PRIORS) {
    for (const re of p.patterns) {
      if (re.test(material)) return p;
    }
  }
  return null;
}

export interface BandCheck {
  ok: boolean;
  band?: [number, number];
  /** How far outside, as a fraction of band width. 0 when inside. */
  distance: number;
}

export function checkBand(
  prior: MaterialPrior,
  unit: Unit,
  price: number
): BandCheck {
  const band = prior.bands[unit];
  if (!band) return { ok: true, distance: 0 };
  const [lo, hi] = band;
  if (price >= lo && price <= hi) return { ok: true, band, distance: 0 };
  const width = Math.max(hi - lo, 1e-6);
  const distance = price < lo ? (lo - price) / width : (price - hi) / width;
  return { ok: false, band, distance };
}

/**
 * The unit RULE 2 requires for a material class, when the class pins it down.
 * Classes that legitimately allow several (bulk that may be bagged) return null
 * and are checked against `prior.units` instead.
 */
export function requiredUnit(cls: MaterialClass): Unit | null {
  switch (cls) {
    case "sod":
      return "sq ft";
    case "plant":
      return "each";
    default:
      return null;
  }
}
