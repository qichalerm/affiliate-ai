CREATE TABLE "affiliate_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"short_id" varchar(16) NOT NULL,
	"product_id" integer,
	"channel" "channel" NOT NULL,
	"campaign" varchar(64),
	"variant" varchar(8),
	"published_post_id" integer,
	"full_url" text NOT NULL,
	"shopee_short_url" varchar(255),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliate_link_id" integer NOT NULL,
	"short_id" varchar(16) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"user_agent_hash" varchar(64) NOT NULL,
	"country_code" varchar(2),
	"referrer" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT true NOT NULL,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_affiliate_link_id_affiliate_links_id_fk" FOREIGN KEY ("affiliate_link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_links_short_id_idx" ON "affiliate_links" USING btree ("short_id");--> statement-breakpoint
CREATE INDEX "affiliate_links_product_channel_idx" ON "affiliate_links" USING btree ("product_id","channel");--> statement-breakpoint
CREATE INDEX "affiliate_links_campaign_idx" ON "affiliate_links" USING btree ("campaign");--> statement-breakpoint
CREATE INDEX "clicks_link_clicked_idx" ON "clicks" USING btree ("affiliate_link_id","clicked_at");--> statement-breakpoint
CREATE INDEX "clicks_short_id_clicked_idx" ON "clicks" USING btree ("short_id","clicked_at");--> statement-breakpoint
CREATE INDEX "clicks_country_idx" ON "clicks" USING btree ("country_code");