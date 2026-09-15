/**
 * Database schema.
 *
 * Two conventions worth knowing before reading:
 *
 * 1. **Money is integer cents, everywhere.** No floats in the database and no
 *    floats in any arithmetic. `lib/money.ts` converts at the API boundary and
 *    nowhere else. A quote that is off by a penny because of float drift is a
 *    quote a contractor has to explain to a customer.
 *
 * 2. **Rates are snapshotted onto the estimate.** Markup and tax live on the
 *    profile as *defaults*, but each estimate stores the rates it was actually
 *    built with. Iowa's rate could change, or the shop's markup could; an
 *    estimate from March must still reproduce March's numbers.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ── profiles ───────────────────────────────────────────────────────────────

export const profiles = pgTable("profiles", {
  /** Clerk user id. Not generated here — Clerk owns identity. */
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  companyName: text("company_name").notNull().default(""),
  /** Basis points, so 2250 = 22.5%. Integers only, same reason as money. */
  defaultMarkupBps: integer("default_markup_bps").notNull().default(2000),
  taxRateBps: integer("tax_rate_bps").notNull().default(700), // Iowa 7%
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── material catalog ───────────────────────────────────────────────────────

/**
 * The materials this account actually buys, at the prices they actually pay.
 *
 * This table is the whole point of the rebuild. A material in here is priced
 * from `unitCostCents` verbatim — never researched, never guessed. The model
 * only prices things that are NOT in here.
 */
export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),

    name: text("name").notNull(),
    category: text("category").notNull().default("other"),
    unit: text("unit").notNull(),

    /** What this account pays the supplier, per unit, in cents. */
    unitCostCents: integer("unit_cost_cents").notNull(),

    supplier: text("supplier").notNull().default(""),
    supplierLocation: text("supplier_location").notNull().default(""),
    sku: text("sku"),

    /**
     * Free text the estimator understands, e.g. "1 yd covers 100 sq ft at 3in".
     * Passed to the model so it can compute quantities from real coverage
     * instead of a general assumption about mulch.
     */
    coverage: text("coverage").notNull().default(""),
    notes: text("notes").notNull().default(""),

    isActive: boolean("is_active").notNull().default(true),
    /** Incremented each time this material lands on an estimate. Drives ordering. */
    useCount: integer("use_count").notNull().default(0),
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("materials_owner_idx").on(t.ownerId),
    index("materials_owner_active_idx").on(t.ownerId, t.isActive),
    // One material name per account. Two "Hardwood mulch" rows at different
    // prices is the ambiguity the whole catalog exists to remove.
    uniqueIndex("materials_owner_name_idx").on(t.ownerId, t.name),
  ]
);

// ── estimates ──────────────────────────────────────────────────────────────

export const estimates = pgTable(
  "estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),

    contractorName: text("contractor_name").notNull().default(""),
    jobAddress: text("job_address").notNull(),
    jobDescription: text("job_description").notNull(),

    status: text("status").notNull().default("draft"), // draft | final

    /** Snapshotted at creation — see the note at the top of this file. */
    markupBps: integer("markup_bps").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull(),

    subtotalLowCents: integer("subtotal_low_cents").notNull().default(0),
    subtotalHighCents: integer("subtotal_high_cents").notNull().default(0),
    deliveryLowCents: integer("delivery_low_cents").notNull().default(0),
    deliveryHighCents: integer("delivery_high_cents").notNull().default(0),
    taxLowCents: integer("tax_low_cents").notNull().default(0),
    taxHighCents: integer("tax_high_cents").notNull().default(0),
    totalLowCents: integer("total_low_cents").notNull().default(0),
    totalHighCents: integer("total_high_cents").notNull().default(0),

    notes: text("notes").notNull().default(""),
    clarifications: jsonb("clarifications")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Gate results, so a reopened estimate still shows what was flagged. */
    verification: jsonb("verification").$type<unknown>(),

    runId: text("run_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("estimates_owner_idx").on(t.ownerId),
    index("estimates_owner_created_idx").on(t.ownerId, t.createdAt),
  ]
);

export const estimateLines = pgTable(
  "estimate_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    estimateId: uuid("estimate_id")
      .notNull()
      .references(() => estimates.id, { onDelete: "cascade" }),

    position: integer("position").notNull(),

    /**
     * Set when this line came from the catalog. Null means the model priced it,
     * and that distinction drives which verification gate applies: a catalog
     * line is checked for exact match, an off-catalog line against a band.
     */
    materialId: uuid("material_id").references(() => materials.id, {
      onDelete: "set null",
    }),
    fromCatalog: boolean("from_catalog").notNull().default(false),

    material: text("material").notNull(),
    qtyMilli: integer("qty_milli").notNull(), // thousandths, so 10.5 yd = 10500
    unit: text("unit").notNull(),
    unitLowCents: integer("unit_low_cents").notNull(),
    unitHighCents: integer("unit_high_cents").notNull(),
    source: text("source").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("estimate_lines_estimate_idx").on(t.estimateId, t.position)]
);

// ── run log and labels ─────────────────────────────────────────────────────

export const estimateRuns = pgTable(
  "estimate_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id").notNull(),
    ownerId: text("owner_id").notNull(),
    estimateId: uuid("estimate_id").references(() => estimates.id, {
      onDelete: "set null",
    }),

    passed: boolean("passed").notNull(),
    repaired: boolean("repaired").notNull().default(false),
    repairSucceeded: boolean("repair_succeeded"),
    gatesFailed: jsonb("gates_failed").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    gateDetail: jsonb("gate_detail").$type<unknown>(),

    catalogLines: integer("catalog_lines").notNull().default(0),
    researchedLines: integer("researched_lines").notNull().default(0),

    latencyMs: integer("latency_ms").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("estimate_runs_owner_idx").on(t.ownerId, t.createdAt),
    uniqueIndex("estimate_runs_run_id_idx").on(t.runId),
  ]
);

/**
 * Lines a contractor corrected after we handed them the estimate.
 *
 * An edited line is a line the model got wrong. This is the label set for
 * anything learned later, and it costs the estimator nothing — they were going
 * to fix that row regardless.
 */
export const lineEdits = pgTable(
  "line_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    runId: text("run_id").notNull(),
    estimateId: uuid("estimate_id").references(() => estimates.id, {
      onDelete: "cascade",
    }),

    lineIndex: integer("line_index").notNull(),
    material: text("material").notNull().default(""),
    field: text("field").notNull(),
    beforeValue: text("before_value").notNull().default(""),
    afterValue: text("after_value").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("line_edits_run_idx").on(t.runId)]
);

// ── relations ──────────────────────────────────────────────────────────────

export const estimatesRelations = relations(estimates, ({ many }) => ({
  lines: many(estimateLines),
}));

export const estimateLinesRelations = relations(estimateLines, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimateLines.estimateId],
    references: [estimates.id],
  }),
  catalogMaterial: one(materials, {
    fields: [estimateLines.materialId],
    references: [materials.id],
  }),
}));

// ── inferred types ─────────────────────────────────────────────────────────

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Material = typeof materials.$inferSelect;
export type NewMaterial = typeof materials.$inferInsert;
export type EstimateRow = typeof estimates.$inferSelect;
export type NewEstimateRow = typeof estimates.$inferInsert;
export type EstimateLineRow = typeof estimateLines.$inferSelect;
export type NewEstimateLineRow = typeof estimateLines.$inferInsert;
export type EstimateRun = typeof estimateRuns.$inferSelect;
export type LineEdit = typeof lineEdits.$inferSelect;
