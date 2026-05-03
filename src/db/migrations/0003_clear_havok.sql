CREATE TYPE "public"."post_status" AS ENUM('queued', 'publishing', 'published', 'failed', 'rate_limited', 'removed');--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"published_post_id" integer NOT NULL,
	"impressions" integer,
	"reach" integer,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"clicks" integer,
	"watch_time_sec" integer,
	"raw" jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "published_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_variant_id" integer,
	"product_id" integer,
	"channel" "channel" NOT NULL,
	"status" "post_status" DEFAULT 'queued' NOT NULL,
	"caption_posted" text,
	"image_url" text,
	"video_url" text,
	"platform_post_id" varchar(128),
	"platform_post_url" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_published_post_id_published_posts_id_fk" FOREIGN KEY ("published_post_id") REFERENCES "public"."published_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_posts" ADD CONSTRAINT "published_posts_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_posts" ADD CONSTRAINT "published_posts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_metrics_post_captured_idx" ON "post_metrics" USING btree ("published_post_id","captured_at");--> statement-breakpoint
CREATE INDEX "published_posts_channel_status_idx" ON "published_posts" USING btree ("channel","status");--> statement-breakpoint
CREATE INDEX "published_posts_published_at_idx" ON "published_posts" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "published_posts_variant_idx" ON "published_posts" USING btree ("content_variant_id");--> statement-breakpoint
CREATE INDEX "published_posts_product_idx" ON "published_posts" USING btree ("product_id");