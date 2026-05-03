CREATE TABLE "insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" varchar(10) NOT NULL,
	"scope" varchar(32) NOT NULL,
	"dimension" varchar(64) NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"revenue_satang" bigint DEFAULT 0 NOT NULL,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"ctr" real,
	"conversion_rate" real,
	"revenue_per_impression" real,
	"roi_ratio" real,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "insights_date_scope_idx" ON "insights" USING btree ("snapshot_date","scope");--> statement-breakpoint
CREATE INDEX "insights_scope_dim_idx" ON "insights" USING btree ("scope","dimension","snapshot_date");