CREATE TABLE "distance_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"miles" double precision NOT NULL,
	"minutes" double precision,
	"source" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series" text NOT NULL,
	"period" text NOT NULL,
	"cents_per_gal" integer NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"matched" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'yard' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"delivery_fee_cents" integer DEFAULT 0 NOT NULL,
	"msha_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'dump' NOT NULL,
	"capacity_tons_milli" integer DEFAULT 0 NOT NULL,
	"capacity_cu_yd_milli" integer DEFAULT 0 NOT NULL,
	"mpg_tenths" integer DEFAULT 60 NOT NULL,
	"cost_per_hour_cents" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "basis" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "haul_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "miles" double precision;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "alternatives" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "job_lat" double precision;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "job_lng" double precision;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "deposit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "tax_haul" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "tax_deposits" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "haul_detail" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "site" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "model_output" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "edited_lines" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "edited_total_low_cents" integer;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "edited_total_high_cents" integer;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "hand_total_cents" integer;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "hand_minutes" integer;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "app_seconds" integer;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "actual_total_cents" integer;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "field_notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "spec_class" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "tons_per_cu_yd_milli" integer;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "haul" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "units_per_pallet_milli" integer;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "pallet_deposit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "tax_haul" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "tax_deposits" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_lat" double precision;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_lng" double precision;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "diesel_override_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avg_mph" integer DEFAULT 35 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "load_minutes" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pickup_stop_minutes" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "trucks_per_job" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "default_haul_miles" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_prices_series_period_idx" ON "fuel_prices" USING btree ("series","period");--> statement-breakpoint
CREATE INDEX "suppliers_owner_idx" ON "suppliers" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_owner_name_idx" ON "suppliers" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "trucks_owner_idx" ON "trucks" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;