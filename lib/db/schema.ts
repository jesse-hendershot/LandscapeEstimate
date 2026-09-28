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
  doublePrecision,
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
  /**
   * What the tax rate applies to. Materials are always taxed. The shop asked
   * for "7% on everything", so hauling defaults on; refundable pallet deposits
   * default off because they come back.
   */
  taxHaul: boolean("tax_haul").notNull().default(true),
  taxDeposits: boolean("tax_deposits").notNull().default(false),

  // ── locality ──
  /** Where the trucks live. Every job adds a round trip from here per truck. */
  shopAddress: text("shop_address").notNull().default(""),
  shopLat: doublePrecision("shop_lat"),
  shopLng: doublePrecision("shop_lng"),
  /**
   * Manual diesel price, cents per gallon. 0 means "use the weekly EIA Midwest
   * retail price", which is the default and the right answer for most weeks.
   */
  dieselOverrideCents: integer("diesel_override_cents").notNull().default(0),
  /** Same idea for gasoline (weekly EIA Midwest regular when 0). */
  gasOverrideCents: integer("gas_override_cents").notNull().default(0),
  /**
   * Dyed off-road diesel for the machines. 0 = road diesel minus the federal
   * and Iowa road taxes it doesn't carry.
   */
  offroadOverrideCents: integer("offroad_override_cents").notNull().default(0),
  /** Average road speed of a working truck. Drives the time half of haul cost. */
  avgMph: integer("avg_mph").notNull().default(35),
  /** Per bulk load: scale, loading and dumping, minutes. */
  loadMinutes: integer("load_minutes").notNull().default(20),
  /** Per store stop: parking, finding it, paying, loading, minutes. */
  pickupStopMinutes: integer("pickup_stop_minutes").notNull().default(25),
  /** Dump trucks sent to a typical job. Overridable per estimate. */
  trucksPerJob: integer("trucks_per_job").notNull().default(1),
  /** Road miles assumed for a supplier with no known location. */
  defaultHaulMiles: integer("default_haul_miles").notNull().default(15),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── trucks ─────────────────────────────────────────────────────────────────

/**
 * Trailers. A dump trailer behind a pickup is how a lot of small shops haul
 * rock, so a truck can pull one and its capacity becomes the trailer's. An
 * equipment trailer is what a machine rides to the job on.
 */
export const trailers = pgTable(
  "trailers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    /** dump | equipment | utility */
    kind: text("kind").notNull().default("dump"),
    capacityTonsMilli: integer("capacity_tons_milli").notNull().default(0),
    capacityCuYdMilli: integer("capacity_cu_yd_milli").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trailers_owner_idx").on(t.ownerId)]
);

/**
 * The shop's fleet. One row per truck. The haul planner reads capacity, mpg
 * and hourly cost; everything else is for the humans.
 */
export const trucks = pgTable(
  "trucks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    /** dump | pickup */
    kind: text("kind").notNull().default("dump"),
    /** diesel | gas — which weekly price its miles are costed at. */
    fuel: text("fuel").notNull().default("diesel"),
    /** The trailer it usually pulls. A dump trailer sets its load size. */
    trailerId: uuid("trailer_id").references(() => trailers.id, { onDelete: "set null" }),
    /** Thousandths, like every other quantity. 14000 = 14 tons. */
    capacityTonsMilli: integer("capacity_tons_milli").notNull().default(0),
    capacityCuYdMilli: integer("capacity_cu_yd_milli").notNull().default(0),
    /** Tenths of a mile per gallon. 60 = 6.0 mpg. */
    mpgTenths: integer("mpg_tenths").notNull().default(60),
    /** Driver + truck per hour, NOT including fuel (fuel is counted by the mile). */
    costPerHourCents: integer("cost_per_hour_cents").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trucks_owner_idx").on(t.ownerId)]
);

/**
 * Machines: skid steers, mini excavators, tractors. Estimates count their
 * fuel (engine hours x gallons an hour) and the trips to haul them out.
 */
export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    /** skid_steer | track_loader | mini_excavator | excavator | tractor | other */
    kind: text("kind").notNull().default("skid_steer"),
    /** offroad | diesel | gas */
    fuel: text("fuel").notNull().default("offroad"),
    /** Tenths of a gallon per engine hour. 30 = 3.0 gal/hr. */
    galPerHourTenths: integer("gal_per_hour_tenths").notNull().default(0),
    /** The trailer it rides to the job on. Null = it drives there or lives on site. */
    trailerId: uuid("trailer_id").references(() => trailers.id, { onDelete: "set null" }),
    /** Round trips shop <-> job to haul it out and bring it back. */
    haulTrips: integer("haul_trips").notNull().default(1),
    notes: text("notes").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("equipment_owner_idx").on(t.ownerId)]
);

// ── suppliers ──────────────────────────────────────────────────────────────

/**
 * Places the shop buys from, with a location. Location is the whole point:
 * a supplier without coordinates can't be priced on distance.
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    /** quarry | yard | big_box | nursery | sod_farm | other */
    kind: text("kind").notNull().default("yard"),
    address: text("address").notNull().default(""),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    phone: text("phone").notNull().default(""),
    notes: text("notes").notNull().default(""),
    /** Flat fee when this supplier delivers (sod farms, block yards). */
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    /** Set when the supplier was added from the federal mine list. */
    mshaId: text("msha_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("suppliers_owner_idx").on(t.ownerId),
    uniqueIndex("suppliers_owner_name_idx").on(t.ownerId, t.name),
  ]
);

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

    // ── locality ──
    /** Where this price comes from. Null for legacy rows priced before suppliers existed. */
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /**
     * Substitute group. Materials sharing a non-empty class do the same job,
     * and the estimator picks whichever is cheapest delivered to the site.
     * The shop decides what's interchangeable; the app never guesses.
     */
    specClass: text("spec_class").notNull().default(""),
    /** Thousandths of a ton per loose cu yd, off the scale ticket. Null = typical value. */
    tonsPerCuYdMilli: integer("tons_per_cu_yd_milli"),
    /** auto | dump | pickup | delivered | none */
    haul: text("haul").notNull().default("auto"),
    /** Pallets: units per pallet (thousandths) and the refundable deposit per pallet. */
    unitsPerPalletMilli: integer("units_per_pallet_milli"),
    palletDepositCents: integer("pallet_deposit_cents").notNull().default(0),

    isActive: boolean("is_active").notNull().default(true),
    /** Incremented each time this material lands on an estimate. Drives ordering. */
    useCount: integer("use_count").notNull().default(0),
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Where the current price came from:
     *   starter  — the app's placeholder, not from any supplier yet
     *   sheet    — the supplier's own price list
     *   receipt  — a receipt, invoice or scale ticket
     *   manual   — typed in by the shop
     * Estimates prefer supplier-backed prices and flag starter ones.
     */
    priceSource: text("price_source").notNull().default("manual"),
    /** "Conklin Quarry price sheet, 2026-09-29" */
    priceSourceLabel: text("price_source_label").notNull().default(""),

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

/**
 * Every price a material has had, and where each came from. The catalog holds
 * the current one; this is the paper trail — what Conklin charged in March
 * versus now, and which sheet or receipt said so.
 */
export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    unitCostCents: integer("unit_cost_cents").notNull(),
    unit: text("unit").notNull(),
    /** starter | sheet | receipt | manual */
    source: text("source").notNull(),
    sourceLabel: text("source_label").notNull().default(""),
    /** Date printed on the sheet or receipt, YYYY-MM-DD, when there was one. */
    observedOn: text("observed_on").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("price_history_owner_material_idx").on(t.ownerId, t.materialId)]
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

    // ── locality ──
    jobLat: doublePrecision("job_lat"),
    jobLng: doublePrecision("job_lng"),
    /** Refundable pallet deposits. Not marked up; taxed only if the profile says so. */
    depositCents: integer("deposit_cents").notNull().default(0),
    /** Snapshotted with the rates: whether haul and deposits were taxed. */
    taxHaul: boolean("tax_haul").notNull().default(true),
    taxDeposits: boolean("tax_deposits").notNull().default(false),
    /** The load plan: trucks, loads, miles, diesel price used. */
    haulDetail: jsonb("haul_detail").$type<unknown>(),
    /** Fuel burned by the machines on site. Taxed with hauling. */
    machineCents: integer("machine_cents").notNull().default(0),
    /** Machine hours as generated: [{ equipmentId, hours, basis }]. */
    machines: jsonb("machines").$type<unknown>(),
    /** Parcel, elevation and drawn measurements the estimate was built on. */
    site: jsonb("site").$type<unknown>(),
    /** The model's raw JSON, kept so a follow-up answer can refine rather than restart. */
    modelOutput: jsonb("model_output").$type<unknown>(),

    // ── the estimator's corrections ──
    /**
     * The estimate as the estimator left it (material rows only). The lines in
     * estimate_lines stay exactly as generated, so the difference between the
     * two is the label set: what the app got wrong, by how much.
     */
    editedLines: jsonb("edited_lines").$type<unknown>(),
    editedTotalLowCents: integer("edited_total_low_cents"),
    editedTotalHighCents: integer("edited_total_high_cents"),
    editedAt: timestamp("edited_at", { withTimezone: true }),

    // ── field test: the app versus the legal pad ──
    handTotalCents: integer("hand_total_cents"),
    handMinutes: integer("hand_minutes"),
    /** Seconds from opening the form to saving, measured in the browser. */
    appSeconds: integer("app_seconds"),
    actualTotalCents: integer("actual_total_cents"),
    fieldNotes: text("field_notes").notNull().default(""),

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

    /** How the quantity was worked out, in words. */
    basis: text("basis").notNull().default(""),
    /** This line's share of the haul, cents. */
    haulCents: integer("haul_cents").notNull().default(0),
    /** One-way road miles from the job to this line's supplier. */
    miles: doublePrecision("miles"),
    /** Other members of the substitute class, priced delivered to this job. */
    alternatives: jsonb("alternatives").$type<unknown>(),
    /** Where this line's price came from when the estimate was built (see materials.priceSource). */
    priceSource: text("price_source").notNull().default(""),
    priceLabel: text("price_label").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("estimate_lines_estimate_idx").on(t.estimateId, t.position)]
);

// ── shared caches (not owner-scoped: nothing here is any shop's data) ─────

/** Address -> coordinates. Geocoders are slow and rate-limited; addresses repeat. */
export const geocodeCache = pgTable("geocode_cache", {
  query: text("query").primaryKey(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  matched: text("matched").notNull().default(""),
  source: text("source").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Road distance between two rounded coordinates. */
export const distanceCache = pgTable("distance_cache", {
  key: text("key").primaryKey(),
  miles: doublePrecision("miles").notNull(),
  minutes: doublePrecision("minutes"),
  source: text("source").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Weekly diesel price, one row per series per week. */
export const fuelPrices = pgTable(
  "fuel_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    series: text("series").notNull(),
    period: text("period").notNull(),
    centsPerGal: integer("cents_per_gal").notNull(),
    source: text("source").notNull().default(""),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fuel_prices_series_period_idx").on(t.series, t.period)]
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
export type TruckRow = typeof trucks.$inferSelect;
export type NewTruckRow = typeof trucks.$inferInsert;
export type TrailerRow = typeof trailers.$inferSelect;
export type NewTrailerRow = typeof trailers.$inferInsert;
export type EquipmentRow = typeof equipment.$inferSelect;
export type NewEquipmentRow = typeof equipment.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type Material = typeof materials.$inferSelect;
export type PriceHistoryRow = typeof priceHistory.$inferSelect;
export type NewMaterial = typeof materials.$inferInsert;
export type EstimateRow = typeof estimates.$inferSelect;
export type NewEstimateRow = typeof estimates.$inferInsert;
export type EstimateLineRow = typeof estimateLines.$inferSelect;
export type NewEstimateLineRow = typeof estimateLines.$inferInsert;
export type EstimateRun = typeof estimateRuns.$inferSelect;
export type LineEdit = typeof lineEdits.$inferSelect;

export const materialsRelations = relations(materials, ({ one }) => ({
  supplierRow: one(suppliers, {
    fields: [materials.supplierId],
    references: [suppliers.id],
  }),
}));
