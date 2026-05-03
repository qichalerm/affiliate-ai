CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warn', 'error', 'critical');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('web', 'facebook', 'instagram', 'tiktok', 'shopee_video');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'pending_review', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('review', 'comparison', 'best_of', 'deal', 'story', 'guide');--> statement-breakpoint
CREATE TYPE "public"."niche" AS ENUM('it_gadget', 'beauty', 'home_appliance', 'sports_fitness', 'mom_baby', 'food_kitchen', 'fashion', 'car_garage');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('shopee', 'tiktok_shop');--> statement-breakpoint
CREATE TYPE "public"."scraper_status" AS ENUM('running', 'success', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"code" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"metadata" jsonb,
	"requires_user_action" boolean DEFAULT false NOT NULL,
	"delivered_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"slug" varchar(64) NOT NULL,
	"name_th" varchar(128) NOT NULL,
	"name_en" varchar(128),
	"niche" "niche",
	"depth" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "content_type" NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"slug" varchar(255) NOT NULL,
	"primary_product_id" integer,
	"related_product_ids" jsonb,
	"category_id" integer,
	"title" varchar(255) NOT NULL,
	"h1" varchar(255),
	"meta_description" text,
	"keywords" jsonb,
	"content_json" jsonb NOT NULL,
	"og_image" text,
	"translations" jsonb,
	"ai_content_percent" integer DEFAULT 100,
	"llm_model" varchar(64),
	"llm_cost_usd" real DEFAULT 0,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"price" bigint NOT NULL,
	"original_price" bigint,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" varchar(64) NOT NULL,
	"shop_id" integer,
	"category_id" integer,
	"name" text NOT NULL,
	"slug" varchar(255) NOT NULL,
	"brand" varchar(128),
	"description" text,
	"primary_image" text,
	"image_urls" jsonb,
	"current_price" bigint,
	"original_price" bigint,
	"discount_percent" real,
	"rating" real,
	"rating_count" integer,
	"sold_count" integer,
	"sold_count_30d" integer,
	"view_count" integer,
	"like_count" integer,
	"affiliate_short_url" varchar(255),
	"demand_score" real,
	"profitability_score" real,
	"trend_velocity" real,
	"final_score" real,
	"competition_score" real,
	"is_active" boolean DEFAULT true NOT NULL,
	"flag_blacklisted" boolean DEFAULT false NOT NULL,
	"flag_regulated" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"raw" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scored_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scraper_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"scraper" varchar(32) NOT NULL,
	"target" varchar(255) NOT NULL,
	"status" "scraper_status" NOT NULL,
	"items_attempted" integer DEFAULT 0,
	"items_succeeded" integer DEFAULT 0,
	"items_failed" integer DEFAULT 0,
	"cost_usd_micros" bigint DEFAULT 0,
	"duration_ms" integer,
	"error_msg" text,
	"raw" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_mall" boolean DEFAULT false NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"rating" real,
	"rating_count" integer,
	"follower_count" integer,
	"product_count" integer,
	"response_rate" real,
	"response_time_hours" real,
	"ship_from_location" varchar(128),
	"created_since_days" integer,
	"reliability_score" real,
	"raw" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_primary_product_id_products_id_fk" FOREIGN KEY ("primary_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_severity_idx" ON "alerts" USING btree ("severity","created_at");--> statement-breakpoint
CREATE INDEX "alerts_unresolved_idx" ON "alerts" USING btree ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_niche_idx" ON "categories" USING btree ("niche");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pages_slug_idx" ON "content_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "content_pages_type_status_idx" ON "content_pages" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "content_pages_primary_product_idx" ON "content_pages" USING btree ("primary_product_id");--> statement-breakpoint
CREATE INDEX "product_prices_product_captured_idx" ON "product_prices" USING btree ("product_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_platform_ext_idx" ON "products" USING btree ("platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_shop_idx" ON "products" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "products_active_idx" ON "products" USING btree ("is_active","flag_blacklisted");--> statement-breakpoint
CREATE INDEX "products_final_score_idx" ON "products" USING btree ("final_score");--> statement-breakpoint
CREATE INDEX "scraper_runs_scraper_started_idx" ON "scraper_runs" USING btree ("scraper","started_at");--> statement-breakpoint
CREATE INDEX "scraper_runs_status_idx" ON "scraper_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_platform_ext_idx" ON "shops" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "shops_reliability_idx" ON "shops" USING btree ("reliability_score");