CREATE TABLE "estimate_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"material_id" uuid,
	"from_catalog" boolean DEFAULT false NOT NULL,
	"material" text NOT NULL,
	"qty_milli" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_low_cents" integer NOT NULL,
	"unit_high_cents" integer NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"estimate_id" uuid,
	"passed" boolean NOT NULL,
	"repaired" boolean DEFAULT false NOT NULL,
	"repair_succeeded" boolean,
	"gates_failed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gate_detail" jsonb,
	"catalog_lines" integer DEFAULT 0 NOT NULL,
	"researched_lines" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"contractor_name" text DEFAULT '' NOT NULL,
	"job_address" text NOT NULL,
	"job_description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"markup_bps" integer NOT NULL,
	"tax_rate_bps" integer NOT NULL,
	"subtotal_low_cents" integer DEFAULT 0 NOT NULL,
	"subtotal_high_cents" integer DEFAULT 0 NOT NULL,
	"delivery_low_cents" integer DEFAULT 0 NOT NULL,
	"delivery_high_cents" integer DEFAULT 0 NOT NULL,
	"tax_low_cents" integer DEFAULT 0 NOT NULL,
	"tax_high_cents" integer DEFAULT 0 NOT NULL,
	"total_low_cents" integer DEFAULT 0 NOT NULL,
	"total_high_cents" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"clarifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification" jsonb,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"run_id" text NOT NULL,
	"estimate_id" uuid,
	"line_index" integer NOT NULL,
	"material" text DEFAULT '' NOT NULL,
	"field" text NOT NULL,
	"before_value" text DEFAULT '' NOT NULL,
	"after_value" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"unit" text NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"supplier" text DEFAULT '' NOT NULL,
	"supplier_location" text DEFAULT '' NOT NULL,
	"sku" text,
	"coverage" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"price_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"default_markup_bps" integer DEFAULT 2000 NOT NULL,
	"tax_rate_bps" integer DEFAULT 700 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_runs" ADD CONSTRAINT "estimate_runs_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_edits" ADD CONSTRAINT "line_edits_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimate_lines_estimate_idx" ON "estimate_lines" USING btree ("estimate_id","position");--> statement-breakpoint
CREATE INDEX "estimate_runs_owner_idx" ON "estimate_runs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_runs_run_id_idx" ON "estimate_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "estimates_owner_idx" ON "estimates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "estimates_owner_created_idx" ON "estimates" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "line_edits_run_idx" ON "line_edits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "materials_owner_idx" ON "materials" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "materials_owner_active_idx" ON "materials" USING btree ("owner_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_owner_name_idx" ON "materials" USING btree ("owner_id","name");