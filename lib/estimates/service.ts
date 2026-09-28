/**
 * Saved estimates: list, open, and save the estimator's edits.
 *
 * The generated lines in estimate_lines are never overwritten. Edits live in
 * `estimates.edited_lines`, and every save re-derives `line_edits` as the diff
 * between the two. That diff is the label set a learned verifier needs — which
 * lines the app got wrong and what the estimator changed them to — and it costs
 * the estimator nothing, because they were fixing those lines anyway.
 *
 * Saving also re-plans the haul: change 20 tons to 30 and the load count, and
 * so the hauling cost, follows. The same goes for machine hours. Substitutes
 * are NOT re-ranked on save; the estimator's choices stand.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { listMaterials } from "../catalog/repo";
import { db } from "../db";
import {
  estimateLines,
  estimates,
  lineEdits,
  type EstimateLineRow,
  type EstimateRow,
  type Material,
  type Profile,
} from "../db/schema";
import { localityOf } from "../geo/geocode";
import { listEquipment } from "../fleet/equipment";
import { listTrailers } from "../fleet/trailers";
import { currentFuel } from "../haul/fuel";
import { machineLabel, normalizeUses, type MachineLine, type MachineUse } from "../haul/machines";
import { fromCents, fromMilli, toCents, toMilli } from "../money";
import { listSuppliers } from "../suppliers/repo";
import { listTrucks } from "../trucks/repo";
import { computeTotals, toLineItems, type BuildOptions, type BuiltEstimate, type BuiltLine } from "../estimate/build";
import { applyLocality, toMachine, type HaulDetail } from "../estimate/locality";
import { isSpecial, type LineAlternative, type LineItem } from "../estimate/schema";

// ── read ───────────────────────────────────────────────────────────────────

export async function listEstimates(ownerId: string, limit = 100) {
  const rows = await db
    .select({
      id: estimates.id,
      createdAt: estimates.createdAt,
      jobAddress: estimates.jobAddress,
      jobDescription: estimates.jobDescription,
      contractorName: estimates.contractorName,
      totalLowCents: estimates.totalLowCents,
      totalHighCents: estimates.totalHighCents,
      editedTotalLowCents: estimates.editedTotalLowCents,
      editedTotalHighCents: estimates.editedTotalHighCents,
      markupBps: estimates.markupBps,
      handTotalCents: estimates.handTotalCents,
      handMinutes: estimates.handMinutes,
      appSeconds: estimates.appSeconds,
      actualTotalCents: estimates.actualTotalCents,
      fieldNotes: estimates.fieldNotes,
      status: estimates.status,
    })
    .from(estimates)
    .where(eq(estimates.ownerId, ownerId))
    .orderBy(desc(estimates.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    jobAddress: r.jobAddress,
    jobDescription: r.jobDescription,
    contractorName: r.contractorName,
    appLow: fromCents(r.editedTotalLowCents ?? r.totalLowCents),
    appHigh: fromCents(r.editedTotalHighCents ?? r.totalHighCents),
    originalLow: fromCents(r.totalLowCents),
    originalHigh: fromCents(r.totalHighCents),
    edited: r.editedTotalLowCents !== null,
    markupPct: r.markupBps / 100,
    handTotal: r.handTotalCents === null ? null : fromCents(r.handTotalCents),
    handMinutes: r.handMinutes,
    appMinutes: r.appSeconds === null ? null : Math.round((r.appSeconds / 60) * 10) / 10,
    actualTotal: r.actualTotalCents === null ? null : fromCents(r.actualTotalCents),
    fieldNotes: r.fieldNotes,
    status: r.status,
  }));
}

export type EstimateListItem = Awaited<ReturnType<typeof listEstimates>>[number];

async function loadRow(ownerId: string, id: string) {
  const [row] = await db
    .select()
    .from(estimates)
    .where(and(eq(estimates.ownerId, ownerId), eq(estimates.id, id)))
    .limit(1);
  if (!row) return null;
  const lines = await db
    .select()
    .from(estimateLines)
    .where(eq(estimateLines.estimateId, row.id))
    .orderBy(asc(estimateLines.position));
  return { row, lines };
}

/** The generated estimate, rendered back to LineItems from the database. */
export function originalItems(row: EstimateRow, lines: EstimateLineRow[]): LineItem[] {
  const built: BuiltEstimate = {
    lines: lines.map(rowToBuilt),
    subtotalLowCents: row.subtotalLowCents,
    subtotalHighCents: row.subtotalHighCents,
    deliveryLowCents: row.deliveryLowCents,
    deliveryHighCents: row.deliveryHighCents,
    haulSource: haulSourceOf(row),
    haulLabel: haulLabelOf(row),
    machineCents: row.machineCents,
    machineLabel: generatedMachineLabel(row),
    depositCents: row.depositCents,
    deposits: [],
    taxLowCents: row.taxLowCents,
    taxHighCents: row.taxHighCents,
    totalLowCents: row.totalLowCents,
    totalHighCents: row.totalHighCents,
    clarifications: row.clarifications,
    notes: row.notes,
    droppedCatalogIds: [],
    qtyMismatches: [],
    catalogLineCount: 0,
    customLineCount: 0,
  };
  return toLineItems(built, row.taxRateBps, { taxHaul: row.taxHaul, taxDeposits: row.taxDeposits });
}

function rowToBuilt(l: EstimateLineRow): BuiltLine {
  return {
    material: l.material,
    qtyMilli: l.qtyMilli,
    unit: l.unit,
    unitLowCents: l.unitLowCents,
    unitHighCents: l.unitHighCents,
    source: l.source,
    fromCatalog: l.fromCatalog,
    materialId: l.materialId,
    basis: l.basis,
    haulCents: l.haulCents,
    miles: l.miles,
    alternatives: (l.alternatives as LineAlternative[] | null) ?? undefined,
    priceSource: l.priceSource || undefined,
    priceLabel: l.priceLabel || undefined,
  };
}

/**
 * The machine label as generated. haul_detail is rewritten on every save, so
 * the generated label is rebuilt from the generated hours when they differ.
 */
function generatedMachineLabel(row: EstimateRow): string {
  const d = row.haulDetail as HaulDetail | null;
  const lines = d?.machines ?? [];
  if (row.machineCents <= 0 || lines.length === 0) return "";
  const gen = new Map(((row.machines as MachineUse[] | null) ?? []).map((u) => [u.equipmentId, u.hours]));
  const asGenerated: MachineLine[] = lines
    .filter((l) => gen.has(l.equipmentId))
    .map((l) => ({ ...l, hours: gen.get(l.equipmentId)! }));
  return machineLabel(asGenerated.length ? asGenerated : lines);
}

function haulSourceOf(row: EstimateRow): BuiltEstimate["haulSource"] {
  const d = row.haulDetail as HaulDetail | null;
  if (d?.plan && d.plan.totalCents > 0) return "computed";
  return row.deliveryHighCents > 0 ? "model" : "none";
}

function haulLabelOf(row: EstimateRow): string {
  const d = row.haulDetail as HaulDetail | null;
  if (!d?.plan) return "Delivery (estimated)";
  const p = d.plan;
  return [
    p.totalLoads ? `${p.totalLoads} load${p.totalLoads === 1 ? "" : "s"}` : "",
    p.pickupStops.length ? `${p.pickupStops.length} store run${p.pickupStops.length === 1 ? "" : "s"}` : "",
    p.commute.trucks ? `${p.commute.trucks} truck${p.commute.trucks === 1 ? "" : "s"}` : "",
    `${Math.round(p.totalMiles)} mi${d.distanceSource === "road" ? "" : " (approx)"}`,
    `diesel $${(d.diesel.centsPerGal / 100).toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function getEstimateView(ownerId: string, id: string) {
  const loaded = await loadRow(ownerId, id);
  if (!loaded) return null;
  const { row, lines } = loaded;
  const original = originalItems(row, lines);
  const edited = Array.isArray(row.editedLines) ? (row.editedLines as LineItem[]) : null;
  const detail = row.haulDetail as HaulDetail | null;

  return {
    id: row.id,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
    contractorName: row.contractorName,
    jobAddress: row.jobAddress,
    jobDescription: row.jobDescription,
    line_items: edited ?? original,
    original_items: original,
    total_low: fromCents(row.editedTotalLowCents ?? row.totalLowCents),
    total_high: fromCents(row.editedTotalHighCents ?? row.totalHighCents),
    clarifications_needed: row.clarifications,
    notes: row.notes,
    verification: row.verification,
    haul: detail,
    site: row.site,
    tax: { ratePct: row.taxRateBps / 100, haul: row.taxHaul, deposits: row.taxDeposits },
    markupPct: row.markupBps / 100,
    trucksForJob: detail?.trucksForJob ?? 1,
    warnings: detail?.warnings ?? [],
    fieldTest: {
      handTotal: row.handTotalCents === null ? null : fromCents(row.handTotalCents),
      handMinutes: row.handMinutes,
      appSeconds: row.appSeconds,
      actualTotal: row.actualTotalCents === null ? null : fromCents(row.actualTotalCents),
      fieldNotes: row.fieldNotes,
    },
    edited: Boolean(edited),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

export type EstimateView = NonNullable<Awaited<ReturnType<typeof getEstimateView>>>;

// ── diff: what the estimator changed ───────────────────────────────────────

export interface LineEditDiff {
  lineIndex: number;
  material: string;
  field: string;
  before: string;
  after: string;
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.0005;

/**
 * Compare the generated lines with the edited ones. Lines are matched by
 * catalog id, then by name, then by position — so reordering isn't an edit,
 * and a swapped-in substitute shows as a material change on the same line.
 */
export function diffLines(original: LineItem[], edited: LineItem[]): LineEditDiff[] {
  const orig = original.filter((i) => !isSpecial(i));
  const next = edited.filter((i) => !isSpecial(i));
  const used = new Set<number>();
  const out: LineEditDiff[] = [];

  const findMatch = (o: LineItem, pos: number): number => {
    const byId = o.materialId
      ? next.findIndex((n, j) => !used.has(j) && n.materialId === o.materialId)
      : -1;
    if (byId >= 0) return byId;
    const byName = next.findIndex((n, j) => !used.has(j) && n.material.trim() === o.material.trim());
    if (byName >= 0) return byName;
    const replaced = next.findIndex((n, j) => !used.has(j) && n.replaced === o.material);
    if (replaced >= 0) return replaced;
    return pos < next.length && !used.has(pos) && next[pos].unit === o.unit ? pos : -1;
  };

  orig.forEach((o, i) => {
    const j = findMatch(o, i);
    if (j < 0) {
      out.push({ lineIndex: i, material: o.material, field: "removed", before: `${o.qty} ${o.unit}`, after: "" });
      return;
    }
    used.add(j);
    const n = next[j];
    if (n.material.trim() !== o.material.trim()) {
      out.push({ lineIndex: i, material: o.material, field: "material", before: o.material, after: n.material });
    }
    if (!same(n.qty, o.qty)) out.push({ lineIndex: i, material: o.material, field: "qty", before: String(o.qty), after: String(n.qty) });
    if (n.unit !== o.unit) out.push({ lineIndex: i, material: o.material, field: "unit", before: o.unit, after: n.unit });
    if (!same(n.low, o.low)) out.push({ lineIndex: i, material: o.material, field: "low", before: String(o.low), after: String(n.low) });
    if (!same(n.high, o.high)) out.push({ lineIndex: i, material: o.material, field: "high", before: String(o.high), after: String(n.high) });
  });

  next.forEach((n, j) => {
    if (used.has(j) || !n.material.trim()) return;
    out.push({ lineIndex: orig.length + j, material: n.material, field: "added", before: "", after: `${n.qty} ${n.unit} @ ${n.low}` });
  });

  return out;
}

// ── write ──────────────────────────────────────────────────────────────────

const lineItemSchema = z.object({
  material: z.string().max(240),
  qty: z.number().min(0).max(1_000_000),
  unit: z.string().max(40),
  low: z.number().min(0).max(1_000_000),
  high: z.number().min(0).max(1_000_000),
  source: z.string().max(400).default(""),
  kind: z.enum(["material", "haul", "machine", "deposit", "tax", "total"]).optional(),
  materialId: z.string().max(40).nullish(),
  fromCatalog: z.boolean().optional(),
  basis: z.string().max(1000).optional(),
  alternatives: z.array(z.any()).max(10).optional(),
  replaced: z.string().max(240).optional(),
  saved: z.number().optional(),
  priceSource: z.string().max(20).optional(),
  priceLabel: z.string().max(240).optional(),
});

export const estimatePatchSchema = z
  .object({
    lines: z.array(lineItemSchema).max(200),
    trucksForJob: z.number().int().min(1).max(10),
    /** Machine hours as the estimator set them; replaces the whole list. */
    machines: z
      .array(z.object({ equipmentId: z.string().max(40), hours: z.number().min(0).max(1000), basis: z.string().max(400).optional() }))
      .max(20),
    markupPct: z.number().min(0).max(300),
    handTotal: z.number().min(0).max(10_000_000).nullable(),
    handMinutes: z.number().int().min(0).max(10_000).nullable(),
    appSeconds: z.number().int().min(0).max(1_000_000).nullable(),
    actualTotal: z.number().min(0).max(10_000_000).nullable(),
    fieldNotes: z.string().max(4000),
    status: z.enum(["draft", "final"]),
  })
  .partial();

export type EstimatePatch = z.infer<typeof estimatePatchSchema>;

/**
 * Where an edited line's price came from. The table marks a price the
 * estimator typed as "manual"; a line added by hand with no mark is theirs too,
 * unless it's a catalog item at the catalog's own price.
 */
function provenance(i: LineItem, m: Material | undefined): Pick<BuiltLine, "priceSource" | "priceLabel"> {
  if (i.priceSource) return { priceSource: i.priceSource, priceLabel: i.priceLabel ?? "" };
  if (m && toCents(i.low) === m.unitCostCents) return { priceSource: m.priceSource, priceLabel: m.priceSourceLabel };
  return { priceSource: "manual", priceLabel: "Entered on this estimate" };
}

function itemsToBuilt(items: LineItem[], catalogById: Map<string, Material>): BuiltLine[] {
  return items
    .filter((i) => !isSpecial(i) && i.material.trim() && i.qty > 0)
    .map((i) => {
      const catalogLine = Boolean(i.materialId && catalogById.has(i.materialId));
      return {
        ...provenance(i, catalogLine ? catalogById.get(i.materialId!) : undefined),
        material: i.material.trim(),
        qtyMilli: toMilli(i.qty),
        unit: i.unit,
        unitLowCents: toCents(i.low),
        unitHighCents: toCents(Math.max(i.low, i.high)),
        source: i.source ?? "",
        fromCatalog: catalogLine,
        materialId: catalogLine ? i.materialId! : null,
        basis: i.basis ?? "",
        alternatives: i.alternatives,
        replaced: i.replaced,
        savedCents: i.saved ? toCents(i.saved) : undefined,
      };
    });
}

export async function saveEstimate(profile: Profile, id: string, patch: EstimatePatch) {
  const loaded = await loadRow(profile.id, id);
  if (!loaded) return null;
  const { row, lines } = loaded;

  const set: Partial<typeof estimates.$inferInsert> = { updatedAt: new Date() };

  if (patch.markupPct !== undefined) set.markupBps = Math.round(patch.markupPct * 100);
  if (patch.handTotal !== undefined) set.handTotalCents = patch.handTotal === null ? null : toCents(patch.handTotal);
  if (patch.handMinutes !== undefined) set.handMinutes = patch.handMinutes;
  if (patch.appSeconds !== undefined) set.appSeconds = patch.appSeconds;
  if (patch.actualTotal !== undefined) set.actualTotalCents = patch.actualTotal === null ? null : toCents(patch.actualTotal);
  if (patch.fieldNotes !== undefined) set.fieldNotes = patch.fieldNotes;
  if (patch.status !== undefined) set.status = patch.status;

  let edits: LineEditDiff[] | null = null;

  if (patch.lines !== undefined || patch.trucksForJob !== undefined || patch.machines !== undefined) {
    const [catalog, suppliers, trucks, trailers, equipment, fuel] = await Promise.all([
      listMaterials(profile.id, { includeInactive: true }),
      listSuppliers(profile.id, { includeInactive: true }),
      listTrucks(profile.id),
      listTrailers(profile.id),
      listEquipment(profile.id),
      currentFuel(profile),
    ]);
    const catalogById = new Map(catalog.map((m) => [m.id, m]));
    const prevItems = Array.isArray(row.editedLines) ? (row.editedLines as LineItem[]) : originalItems(row, lines);
    const items = (patch.lines as LineItem[] | undefined) ?? prevItems;
    const builtLines = itemsToBuilt(items, catalogById);

    const buildOpts: BuildOptions = {
      taxRateBps: row.taxRateBps,
      taxHaul: row.taxHaul,
      taxDeposits: row.taxDeposits,
    };

    const base: BuiltEstimate = computeTotals(
      {
        lines: builtLines,
        subtotalLowCents: 0,
        subtotalHighCents: 0,
        deliveryLowCents: row.deliveryLowCents,
        deliveryHighCents: row.deliveryHighCents,
        haulSource: haulSourceOf(row),
        haulLabel: haulLabelOf(row),
        machineCents: 0,
        machineLabel: "",
        depositCents: row.depositCents,
        deposits: [],
        taxLowCents: 0,
        taxHighCents: 0,
        totalLowCents: 0,
        totalHighCents: 0,
        clarifications: row.clarifications,
        notes: row.notes,
        droppedCatalogIds: [],
        qtyMismatches: [],
        catalogLineCount: 0,
        customLineCount: 0,
      },
      buildOpts
    );

    const prevDetail = row.haulDetail as HaulDetail | null;
    const trucksForJob = patch.trucksForJob ?? prevDetail?.trucksForJob ?? profile.trucksPerJob;
    // Machine hours: this save's, else the last save's, else as generated.
    const machineRows = equipment.map(toMachine);
    const machineUses = normalizeUses(
      patch.machines ??
        prevDetail?.machines?.map((l) => ({ equipmentId: l.equipmentId, hours: l.hours, basis: l.basis })) ??
        row.machines,
      machineRows
    ).uses;
    const job = row.jobLat !== null && row.jobLng !== null ? { lat: row.jobLat, lng: row.jobLng } : null;

    // Runs without a job location too: machine fuel and deposits don't need one.
    const loc = await applyLocality({
      built: base,
      catalog,
      suppliers,
      trucks,
      trailers,
      equipment,
      machines: machineUses,
      profile,
      job,
      trucksForJob,
      fuel,
      bias: localityOf(profile.shopAddress) || "Iowa City, IA",
      buildOpts,
      rank: false,
    });
    const built = loc.built;
    const detail = loc.detail;

    const newItems = toLineItems(built, row.taxRateBps, buildOpts);
    set.editedLines = newItems;
    set.editedTotalLowCents = built.totalLowCents;
    set.editedTotalHighCents = built.totalHighCents;
    set.editedAt = new Date();
    set.haulDetail = detail;

    edits = diffLines(originalItems(row, lines), newItems);
  }

  await db.update(estimates).set(set).where(and(eq(estimates.ownerId, profile.id), eq(estimates.id, id)));

  if (edits) {
    // Derived rows: replaced wholesale on every save, so they always describe
    // the final state of the estimate against what was generated.
    await db.delete(lineEdits).where(and(eq(lineEdits.ownerId, profile.id), eq(lineEdits.estimateId, id)));
    if (edits.length) {
      await db.insert(lineEdits).values(
        edits.slice(0, 300).map((e) => ({
          ownerId: profile.id,
          runId: row.runId ?? "",
          estimateId: id,
          lineIndex: e.lineIndex,
          material: e.material,
          field: e.field,
          beforeValue: e.before,
          afterValue: e.after,
        }))
      );
    }
  }

  return getEstimateView(profile.id, id);
}

/** Qty in a LineItem is a float for the UI; this keeps it tidy in labels. */
export const showQty = (milli: number) => fromMilli(milli);
