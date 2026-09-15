/**
 * Starter catalog.
 *
 * These are the materials a small Iowa landscaping outfit buys most weeks, at
 * plausible Iowa City / Cedar Rapids supplier pricing. They are a STARTING
 * POINT, not data — every price here is my estimate, and the whole value of the
 * catalog is that it holds numbers you have actually paid.
 *
 * The seed exists so a new account has something to estimate against on day
 * one instead of an empty table. First real job, correct the prices; after that
 * the catalog is yours and this file stops mattering.
 *
 * `coverage` matters more than it looks. It is passed to the model verbatim, so
 * "1 cu yd covers 100 sq ft at 3 in" turns quantity estimation from a general
 * assumption about mulch into arithmetic against your actual product.
 */

import { toCents } from "../money";

export interface SeedMaterial {
  name: string;
  category: string;
  unit: string;
  unitCost: number; // dollars; converted on insert
  supplier: string;
  supplierLocation: string;
  coverage: string;
  notes: string;
}

export const CATEGORIES = [
  "mulch",
  "soil",
  "aggregate",
  "sod",
  "hardscape",
  "edging",
  "fabric",
  "hardware",
  "amendment",
  "plant",
  "other",
] as const;

export const SEED_CATALOG: SeedMaterial[] = [
  // ── mulch ────────────────────────────────────────────────────────────────
  {
    name: "Shredded hardwood mulch (bulk)",
    category: "mulch",
    unit: "cu yd",
    unitCost: 38.0,
    supplier: "",
    supplierLocation: "Iowa City, IA",
    coverage: "1 cu yd covers ~100 sq ft at 3 in depth",
    notes: "Standard bed mulch. Most-used item most seasons.",
  },
  {
    name: "Dyed mulch, black (bulk)",
    category: "mulch",
    unit: "cu yd",
    unitCost: 46.0,
    supplier: "",
    supplierLocation: "Iowa City, IA",
    coverage: "1 cu yd covers ~100 sq ft at 3 in depth",
    notes: "Color fades by late summer; price a refresh accordingly.",
  },
  {
    name: "Shredded hardwood mulch (2 cu ft bag)",
    category: "mulch",
    unit: "bag",
    unitCost: 4.25,
    supplier: "",
    supplierLocation: "",
    coverage: "1 bag covers ~8 sq ft at 3 in depth; 13.5 bags = 1 cu yd",
    notes: "Only for beds under ~1 cu yd. Bulk is cheaper past that.",
  },

  // ── soil ─────────────────────────────────────────────────────────────────
  {
    name: "Screened topsoil (bulk)",
    category: "soil",
    unit: "cu yd",
    unitCost: 30.0,
    supplier: "",
    supplierLocation: "Iowa City, IA",
    coverage: "1 cu yd covers ~160 sq ft at 2 in depth",
    notes: "",
  },
  {
    name: "Compost (bulk)",
    category: "soil",
    unit: "cu yd",
    unitCost: 42.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 cu yd covers ~160 sq ft at 2 in depth",
    notes: "",
  },
  {
    name: "Garden / planting mix (bulk)",
    category: "soil",
    unit: "cu yd",
    unitCost: 44.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 cu yd fills a 4x8 raised bed to ~10 in",
    notes: "Topsoil/compost blend for raised beds and new plantings.",
  },
  {
    name: "Fill dirt (bulk)",
    category: "soil",
    unit: "cu yd",
    unitCost: 14.0,
    supplier: "",
    supplierLocation: "",
    coverage: "",
    notes: "Grade work and backfill only, not a growing medium.",
  },

  // ── aggregate ────────────────────────────────────────────────────────────
  {
    name: "Crushed limestone / road rock",
    category: "aggregate",
    unit: "ton",
    unitCost: 23.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 ton covers ~100 sq ft at 2 in; ~1.35 ton per cu yd",
    notes: "Base course under pavers and drives.",
  },
  {
    name: "Clean stone, 1 in",
    category: "aggregate",
    unit: "ton",
    unitCost: 33.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 ton covers ~100 sq ft at 2 in",
    notes: "Drainage, French drains, dry wells.",
  },
  {
    name: "Pea gravel",
    category: "aggregate",
    unit: "ton",
    unitCost: 48.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 ton covers ~100 sq ft at 2 in",
    notes: "",
  },
  {
    name: "River rock",
    category: "aggregate",
    unit: "ton",
    unitCost: 62.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 ton covers ~80 sq ft at 3 in",
    notes: "Decorative bed cover, dry creek beds.",
  },
  {
    name: "Paver / leveling sand",
    category: "aggregate",
    unit: "ton",
    unitCost: 27.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 ton covers ~110 sq ft at 1 in bedding layer",
    notes: "",
  },

  // ── sod and seed ─────────────────────────────────────────────────────────
  {
    name: "Bluegrass blend sod",
    category: "sod",
    unit: "sq ft",
    unitCost: 0.52,
    supplier: "",
    supplierLocation: "",
    coverage: "Sold by the sq ft; pallets typically 400-500 sq ft",
    notes: "Order 5-10% over measured area for cuts and waste.",
  },
  {
    name: "Starter fertilizer (50 lb bag)",
    category: "amendment",
    unit: "bag",
    unitCost: 32.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 bag covers ~12,500 sq ft",
    notes: "Goes down with every sod and seed job.",
  },
  {
    name: "Grass seed, sun/shade mix (25 lb bag)",
    category: "amendment",
    unit: "bag",
    unitCost: 78.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 bag covers ~5,000 sq ft at new-lawn rate",
    notes: "",
  },
  {
    name: "Straw erosion blanket",
    category: "fabric",
    unit: "roll",
    unitCost: 46.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 roll covers ~450 sq ft (8 ft x 56 ft)",
    notes: "Slopes and new seed on grade.",
  },

  // ── hardscape ────────────────────────────────────────────────────────────
  {
    name: "Holland paver",
    category: "hardscape",
    unit: "sq ft",
    unitCost: 3.4,
    supplier: "",
    supplierLocation: "",
    coverage: "Sold by the sq ft; add 5% for cuts",
    notes: "",
  },
  {
    name: "Retaining wall block",
    category: "hardscape",
    unit: "each",
    unitCost: 5.25,
    supplier: "",
    supplierLocation: "",
    coverage: "Typical block covers ~0.5 sq ft of wall face",
    notes: "",
  },
  {
    name: "Polymeric jointing sand (50 lb bag)",
    category: "hardscape",
    unit: "bag",
    unitCost: 34.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 bag fills joints for ~75 sq ft of pavers",
    notes: "",
  },

  // ── edging, fabric, hardware ─────────────────────────────────────────────
  {
    name: "Steel landscape edging",
    category: "edging",
    unit: "linear ft",
    unitCost: 2.35,
    supplier: "",
    supplierLocation: "",
    coverage: "Sold in 8 ft or 16 ft sections",
    notes: "",
  },
  {
    name: "Paver edge restraint",
    category: "edging",
    unit: "linear ft",
    unitCost: 2.1,
    supplier: "",
    supplierLocation: "",
    coverage: "",
    notes: "",
  },
  {
    name: "Landscape fabric (3 ft x 100 ft roll)",
    category: "fabric",
    unit: "roll",
    unitCost: 38.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 roll covers 300 sq ft",
    notes: "",
  },
  {
    name: "Fabric / sod staples (pack of 75)",
    category: "hardware",
    unit: "pack",
    unitCost: 15.0,
    supplier: "",
    supplierLocation: "",
    coverage: "~1 staple per 3-4 sq ft of fabric",
    notes: "",
  },
  {
    name: "Tree staking kit",
    category: "hardware",
    unit: "each",
    unitCost: 18.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 kit per tree",
    notes: "Only for trees over ~1.5 in caliber or exposed sites.",
  },
  {
    name: "Root stimulator concentrate",
    category: "amendment",
    unit: "bottle",
    unitCost: 22.0,
    supplier: "",
    supplierLocation: "",
    coverage: "1 bottle treats ~20 shrubs or 6 trees",
    notes: "",
  },
];

export function seedRowsFor(ownerId: string) {
  return SEED_CATALOG.map((m, i) => ({
    ownerId,
    name: m.name,
    category: m.category,
    unit: m.unit,
    unitCostCents: toCents(m.unitCost),
    supplier: m.supplier,
    supplierLocation: m.supplierLocation,
    coverage: m.coverage,
    notes: m.notes,
    isActive: true,
    // Seeded order becomes the initial "most common" order until real use
    // counts take over.
    useCount: Math.max(0, SEED_CATALOG.length - i),
  }));
}
