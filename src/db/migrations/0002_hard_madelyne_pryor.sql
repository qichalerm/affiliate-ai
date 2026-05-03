CREATE TYPE "public"."variant_angle" AS ENUM('deal', 'story', 'educational', 'listicle', 'trend', 'brand', 'faq');--> statement-breakpoint
CREATE TABLE "content_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"channel" "channel" NOT NULL,
	"angle" "variant_angle" NOT NULL,
	"variant_code" varchar(8) NOT NULL,
	"caption" text NOT NULL,
	"hashtags" jsonb,
	"hook" text,
	"generation_run_id" integer,
	"llm_model" varchar(64),
	"gate_approved" boolean DEFAULT false NOT NULL,
	"gate_issues" jsonb,
	"times_shown" integer DEFAULT 0 NOT NULL,
	"times_clicked" integer DEFAULT 0 NOT NULL,
	"times_converted" integer DEFAULT 0 NOT NULL,
	"revenue_satang" bigint DEFAULT 0 NOT NULL,
	"bandit_weight" real DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task" varchar(64) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(64),
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_msg" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_variants_product_channel_idx" ON "content_variants" USING btree ("product_id","channel");--> statement-breakpoint
CREATE INDEX "content_variants_active_idx" ON "content_variants" USING btree ("is_active","gate_approved");--> statement-breakpoint
CREATE INDEX "content_variants_bandit_idx" ON "content_variants" USING btree ("bandit_weight");--> statement-breakpoint
CREATE INDEX "generation_runs_task_created_idx" ON "generation_runs" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "generation_runs_provider_created_idx" ON "generation_runs" USING btree ("provider","created_at");