/**
 * Gates for the catalog-first flow.
 *
 * Three gates from the old stack are gone, and their absence is the point:
 *
 *   tax_math      — tax is computed, not requested. Cannot be wrong.
 *   total_math    — same.
 *   required_rows — the bottom-line rows are appended by code. Always present.
 *
 * Deleting a gate because the error it caught can no longer occur is a better
 * outcome than the gate passing every time.
 *
 * What is left is what the model can still get wrong: quantities, units on
 * custom lines, sources on custom lines, duplicating a catalog material as a
 * custom one, and prices for things the shop does not stock.
 */

import type { BuiltEstimate, BuiltLine } from "./build";
import { extendCents, fromCents, fromMilli } from "../money";
import { fail, pass, type GateResult } from "./schema";
import { checkBand, matchPrior } from "./priors";
import { parseUnit } from "./schema";

const BANNED_SOURCES = [
  "sodcalculator", "homeadvisor", "angi", "angieslist", "thumbtack",
  "homeyou", "fixr", "homewyse", "costhelper", "improvenet", "porch.com", "houzz",
];

const BARE_CHAINS =
  /^(home\s*depot|lowe'?s|menards|walmart|ace\s*hardware|tractor\s*supply)\.?$/i;

/**
 * Quantities that would be unusual on any residential or light-commercial job.
 *
 * These are warnings, never hard failures — a commercial job really can take
 * 200 cu yd of mulch. The purpose is to surface the 10x slip (4.5 becoming 45)
 * which is the single most expensive arithmetic error available here, and which
 * nothing else in the stack would catch because the price per unit is correct.
 */
const QTY_CEILING: Record<string, number> = {
  "cu yd": 120,
  ton: 150,
  "sq ft": 20000,
  "linear ft": 2000,
  bag: 400,
  roll: 60,
  pack: 60,
  bottle: 40,
  each: 500,
};

// ── gates ──────────────────────────────────────────────────────────────────

export function gateDroppedIds(built: BuiltEstimate): GateResult[] {
  if (built.droppedCatalogIds.length === 0) {
    return [pass("catalog_ids", "every catalog reference resolved")];
  }
  // The model invented an id. The line was dropped rather than guessed at, so
  // the estimate is short a material — repairable, and worth re-asking.
  return [
    fail(
      "catalog_ids",
      `${built.droppedCatalogIds.length} catalog reference(s) matched nothing in your catalog and were dropped`,
      { repairable: true }
    ),
  ];
}

export function gateHasLines(built: BuiltEstimate): GateResult[] {
  if (built.lines.length === 0) {
    return [fail("structure", "no material lines were produced", { repairable: true })];
  }
  return [pass("structure", `${built.lines.length} material line(s)`)];
}

export function gateUnits(built: BuiltEstimate): GateResult[] {
  const bad: number[] = [];
  built.lines.forEach((l, i) => {
    if (parseUnit(l.unit) === null) bad.push(i);
  });
  if (bad.length === 0) return [pass("units", "all units recognized")];

  const names = bad.map((i) => `"${built.lines[i].unit}"`).join(", ");
  return [
    fail("units", `${bad.length} line(s) use an unrecognized unit: ${names}`, {
      repairable: true,
      lines: bad,
    }),
  ];
}

export function gateSources(built: BuiltEstimate): GateResult[] {
  const out: GateResult[] = [];
  const banned: number[] = [];
  const missing: number[] = [];
  const bare: number[] = [];

  built.lines.forEach((l, i) => {
    if (l.fromCatalog) return; // catalog lines carry the supplier from the catalog
    const src = (l.source || "").trim();
    if (!src) return void missing.push(i);
    const lower = src.toLowerCase();
    if (BANNED_SOURCES.some((b) => lower.includes(b))) return void banned.push(i);
    if (BARE_CHAINS.test(src)) bare.push(i);
  });

  if (banned.length) {
    out.push(
      fail(
        "sources",
        `${banned.length} custom line(s) cite an estimating site rather than a seller: ` +
          banned.map((i) => `"${built.lines[i].source}"`).join(", "),
        { repairable: true, lines: banned }
      )
    );
  }
  if (missing.length) {
    out.push(
      fail("sources", `${missing.length} custom line(s) have no source`, {
        repairable: true,
        lines: missing,
      })
    );
  }
  if (bare.length) {
    out.push(
      fail(
        "sources",
        `${bare.length} custom line(s) name a chain with no location: ` +
          bare.map((i) => `"${built.lines[i].source}"`).join(", "),
        { repairable: true, severity: "warn", lines: bare }
      )
    );
  }

  return out.length ? out : [pass("sources", "custom line sources are named sellers")];
}

export function gateBounds(built: BuiltEstimate): GateResult[] {
  const hard: string[] = [];
  const hardLines: number[] = [];
  const soft: string[] = [];
  const softLines: number[] = [];

  built.lines.forEach((l, i) => {
    // Catalog lines are priced from the catalog and are exact by construction.
    // Checking them would only ever re-flag a price the shop chose on purpose.
    if (l.fromCatalog) return;

    const prior = matchPrior(l.material);
    const u = parseUnit(l.unit);
    if (!prior || !u) return;

    const c = checkBand(prior, u, fromCents(l.unitHighCents));
    if (c.ok) return;

    const [lo, hi] = c.band!;
    const msg =
      `"${l.material}" at $${fromCents(l.unitHighCents).toFixed(2)}/${u} ` +
      `(expected $${lo}–$${hi}/${u})`;
    if (c.distance > 1.0) {
      hard.push(msg);
      hardLines.push(i);
    } else {
      soft.push(msg);
      softLines.push(i);
    }
  });

  const out: GateResult[] = [];
  if (hard.length) {
    out.push(
      fail("bounds", `${hard.length} custom price(s) far outside range: ${hard.join("; ")}`, {
        repairable: true,
        lines: hardLines,
      })
    );
  }
  if (soft.length) {
    out.push(
      fail("bounds", soft.join("; "), { repairable: false, severity: "warn", lines: softLines })
    );
  }
  return out.length ? out : [pass("bounds", "custom prices within expected ranges")];
}

export function gateQuantities(built: BuiltEstimate): GateResult[] {
  const flagged: string[] = [];
  const lines: number[] = [];

  built.lines.forEach((l, i) => {
    const u = parseUnit(l.unit);
    if (!u) return;
    const ceiling = QTY_CEILING[u];
    if (!ceiling) return;
    const qty = fromMilli(l.qtyMilli);
    if (qty > ceiling) {
      flagged.push(`${qty} ${u} of "${l.material}" (unusual above ${ceiling})`);
      lines.push(i);
    }
  });

  if (flagged.length === 0) return [pass("quantities", "quantities look plausible")];
  return [
    fail("quantities", `check these quantities: ${flagged.join("; ")}`, {
      repairable: false,
      severity: "warn",
      lines,
    }),
  ];
}

export function gateDuplicates(built: BuiltEstimate): GateResult[] {
  // The failure that matters here is a custom line duplicating something the
  // catalog already covers — it means the shop gets billed twice for one
  // material, at a researched price instead of their own.
  const byPrior = new Map<string, number[]>();
  built.lines.forEach((l, i) => {
    const p = matchPrior(l.material);
    if (!p) return;
    byPrior.set(p.key, [...(byPrior.get(p.key) ?? []), i]);
  });

  const out: GateResult[] = [];
  for (const [key, idxs] of byPrior) {
    if (idxs.length < 2) continue;
    const mixed = idxs.some((i) => built.lines[i].fromCatalog) &&
      idxs.some((i) => !built.lines[i].fromCatalog);
    if (mixed) {
      out.push(
        fail(
          "duplicates",
          `"${key}" appears both as a catalog line and a custom line — the catalog entry should cover it`,
          { repairable: true, lines: idxs }
        )
      );
    } else {
      const units = new Set(idxs.map((i) => parseUnit(built.lines[i].unit) ?? built.lines[i].unit));
      if (units.size > 1) {
        out.push(
          fail("duplicates", `"${key}" appears in two different units — pick bulk or bagged`, {
            repairable: true,
            lines: idxs,
          })
        );
      }
    }
  }

  return out.length ? out : [pass("duplicates", "no duplicated materials")];
}

export function gateCatalogCoverage(built: BuiltEstimate): GateResult[] {
  const total = built.lines.length;
  if (total === 0) return [pass("catalog_coverage", "nothing to measure")];

  const ratio = built.catalogLineCount / total;
  // Not a correctness failure — a signal. A low ratio means either the catalog
  // is thin or the model ignored it, and both are worth knowing because the
  // whole accuracy argument rests on catalog lines dominating.
  if (ratio < 0.5) {
    return [
      fail(
        "catalog_coverage",
        `only ${built.catalogLineCount} of ${total} lines came from your catalog — ` +
          `the rest were priced from the web and are less reliable`,
        { repairable: false, severity: "warn" }
      ),
    ];
  }
  return [
    pass("catalog_coverage", `${built.catalogLineCount}/${total} lines priced from your catalog`),
  ];
}

// ── runner ─────────────────────────────────────────────────────────────────

export interface BuildVerdict {
  gates: GateResult[];
  errors: GateResult[];
  warnings: GateResult[];
  passed: boolean;
  repairable: boolean;
}

export function verifyBuild(built: BuiltEstimate): BuildVerdict {
  const gates = [
    ...gateHasLines(built),
    ...gateDroppedIds(built),
    ...gateUnits(built),
    ...gateSources(built),
    ...gateDuplicates(built),
    ...gateQuantities(built),
    ...gateBounds(built),
    ...gateCatalogCoverage(built),
  ];

  const errors = gates.filter((g) => !g.passed && g.severity === "error");
  const warnings = gates.filter((g) => !g.passed && g.severity === "warn");

  return {
    gates,
    errors,
    warnings,
    passed: errors.length === 0,
    repairable: errors.length > 0 && errors.every((g) => g.repairable),
  };
}

export function repairInstruction(errors: GateResult[], built: BuiltEstimate): string {
  const bullets = errors.map((e) => {
    const where =
      e.lines && e.lines.length
        ? ` — affects: ${e.lines.map((i) => `"${built.lines[i]?.material ?? "?"}"`).join(", ")}`
        : "";
    return `- [${e.gate}] ${e.detail}${where}`;
  });

  return `Your previous materials list failed automated validation:

${bullets.join("\n")}

Return the COMPLETE corrected JSON in the same format. Fix only what is listed — keep every line that was not flagged, with the same quantities and sources. Remember: no tax row, no totals, no prices on catalog_lines.`;
}
