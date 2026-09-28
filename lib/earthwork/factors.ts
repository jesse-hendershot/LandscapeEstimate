/**
 * Earthwork factors: the handful of numbers that turn a hole in the ground
 * into a truck order.
 *
 * Three different "cubic yards" exist on every job, and confusing them is the
 * classic estimating error (it's the core of any excavation workbook, *Moving
 * the Earth* included):
 *
 *   bank      — material as it sits in the ground, undisturbed
 *   loose     — the same material after it's dug or loaded; it swells
 *   compacted — after it's placed and run over with a plate or roller; it shrinks
 *
 * Suppliers sell LOOSE yards (or tons, weighed loose on a scale). Plans and job
 * descriptions describe FINISHED depth, which for a base course means
 * COMPACTED. So ordering 4 in of road rock for a 4 in compacted base orders too
 * little, by roughly the compaction allowance below.
 *
 * Every value here is a typical published figure, not a measurement of any
 * particular quarry's product. A material's own `tonsPerCuYd` in the catalog
 * always overrides the default density — that's the number off the supplier's
 * scale ticket, and it beats any table.
 */

export type EarthKind =
  | "road_base" // crushed limestone with fines: road rock, Class A, 3/4 in minus
  | "clean_stone" // washed, no fines: drain rock, #57, 1 in clean
  | "pea_gravel"
  | "river_rock"
  | "riprap"
  | "sand"
  | "topsoil"
  | "fill"
  | "compost"
  | "mulch"
  | "other";

export interface EarthFactors {
  /** Tons per LOOSE cubic yard. */
  tonsPerCuYd: number;
  /**
   * Loose yards to order per finished yard in place. >1 means the material
   * compacts or settles after placement.
   */
  placeFactor: number;
  /**
   * Swell from bank (in-ground) to loose, as a multiplier. Only meaningful for
   * material being dug out, i.e. spoil to haul away.
   */
  swell: number;
  label: string;
}

export const EARTH_FACTORS: Record<EarthKind, EarthFactors> = {
  road_base: { tonsPerCuYd: 1.4, placeFactor: 1.2, swell: 1.12, label: "crushed stone base (with fines)" },
  clean_stone: { tonsPerCuYd: 1.35, placeFactor: 1.05, swell: 1.12, label: "clean washed stone" },
  pea_gravel: { tonsPerCuYd: 1.4, placeFactor: 1.0, swell: 1.12, label: "pea gravel" },
  river_rock: { tonsPerCuYd: 1.35, placeFactor: 1.0, swell: 1.12, label: "river rock" },
  riprap: { tonsPerCuYd: 1.4, placeFactor: 1.0, swell: 1.3, label: "rip rap" },
  sand: { tonsPerCuYd: 1.35, placeFactor: 1.1, swell: 1.12, label: "sand" },
  topsoil: { tonsPerCuYd: 1.1, placeFactor: 1.15, swell: 1.43, label: "topsoil" },
  fill: { tonsPerCuYd: 1.2, placeFactor: 1.25, swell: 1.25, label: "fill dirt" },
  compost: { tonsPerCuYd: 0.55, placeFactor: 1.1, swell: 1.1, label: "compost" },
  mulch: { tonsPerCuYd: 0.3, placeFactor: 1.0, swell: 1.0, label: "mulch" },
  other: { tonsPerCuYd: 1.3, placeFactor: 1.0, swell: 1.25, label: "bulk material" },
};

/**
 * Iowa soils are mostly loams and clay loams. Excavated spoil from a trench or
 * a dig-out is hauled LOOSE, so a 10 bank-yard trench fills 12.5 yards of
 * truck bed.
 */
export const NATIVE_SOIL_SWELL = 1.25;

const RULES: [RegExp, EarthKind][] = [
  [/rip\s*-?\s*rap/i, "riprap"],
  [/pea\s*gravel/i, "pea_gravel"],
  [/river\s*rock|decorative\s*(rock|stone)/i, "river_rock"],
  [/clean|washed|drain(age)?\s*(rock|stone)|#\s*57|#57/i, "clean_stone"],
  [/road\s*(rock|stone)|class\s*[a-d]\b|base\s*(rock|course|stone)|crushed\s*(limestone|stone|rock)|minus|recycled\s*concrete|\bcrusher\s*run/i, "road_base"],
  [/sand/i, "sand"],
  [/top\s*soil|black\s*dirt|garden\s*soil|planting\s*mix|soil\s*mix/i, "topsoil"],
  [/fill\s*(dirt)?|clay\s*fill/i, "fill"],
  [/compost/i, "compost"],
  [/mulch|wood\s*chip/i, "mulch"],
];

/** Classify a material by name (and category as a tiebreaker). */
export function earthKind(name: string, category = ""): EarthKind {
  for (const [re, kind] of RULES) if (re.test(name)) return kind;
  const c = category.toLowerCase();
  if (c === "mulch") return "mulch";
  if (c === "soil") return "topsoil";
  if (c === "aggregate") return "road_base";
  return "other";
}

export function factorsFor(name: string, category = ""): EarthFactors {
  return EARTH_FACTORS[earthKind(name, category)];
}
