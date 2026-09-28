CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'skid_steer' NOT NULL,
	"fuel" text DEFAULT 'offroad' NOT NULL,
	"gal_per_hour_tenths" integer DEFAULT 0 NOT NULL,
	"trailer_id" uuid,
	"haul_trips" integer DEFAULT 1 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trailers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'dump' NOT NULL,
	"capacity_tons_milli" integer DEFAULT 0 NOT NULL,
	"capacity_cu_yd_milli" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "machine_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "machines" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "gas_override_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "offroad_override_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "fuel" text DEFAULT 'diesel' NOT NULL;--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "trailer_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_trailer_id_trailers_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_owner_idx" ON "equipment" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "trailers_owner_idx" ON "trailers" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_trailer_id_trailers_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailers"("id") ON DELETE set null ON UPDATE no action;