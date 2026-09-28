CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"material_id" uuid NOT NULL,
	"supplier_id" uuid,
	"unit_cost_cents" integer NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"source_label" text DEFAULT '' NOT NULL,
	"observed_on" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "price_source" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "price_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "price_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "price_source_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_history_owner_material_idx" ON "price_history" USING btree ("owner_id","material_id");--> statement-breakpoint
-- Starter catalog rows whose price nobody has changed are placeholders, not supplier prices.
UPDATE "materials" SET "price_source" = 'starter', "price_source_label" = 'Starter price' WHERE "name" IN ('Shredded hardwood mulch (bulk)', 'Dyed mulch, black (bulk)', 'Shredded hardwood mulch (2 cu ft bag)', 'Screened topsoil (bulk)', 'Compost (bulk)', 'Garden / planting mix (bulk)', 'Fill dirt (bulk)', 'Crushed limestone / road rock', 'Clean stone, 1 in', 'Pea gravel', 'River rock', 'Paver / leveling sand', 'Bluegrass blend sod', 'Starter fertilizer (50 lb bag)', 'Grass seed, sun/shade mix (25 lb bag)', 'Straw erosion blanket', 'Holland paver', 'Retaining wall block', 'Polymeric jointing sand (50 lb bag)', 'Steel landscape edging', 'Paver edge restraint', 'Landscape fabric (3 ft x 100 ft roll)', 'Fabric / sod staples (pack of 75)', 'Tree staking kit', 'Root stimulator concentrate') AND "price_updated_at" <= "created_at" + interval '1 minute';--> statement-breakpoint
-- Receipt-scanned rows already say so in their notes.
UPDATE "materials" SET "price_source" = 'receipt', "price_source_label" = 'Scanned receipt' WHERE "notes" LIKE 'Added from a scanned receipt%';
