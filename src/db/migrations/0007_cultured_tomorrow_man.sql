CREATE TYPE "public"."promo_event_type" AS ENUM('price_drop', 'discount_jump', 'sold_surge', 'new_low');--> statement-breakpoint
CREATE TABLE "promo_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"event_type" "promo_event_type" NOT NULL,
	"signal_strength" real NOT NULL,
	"prev_value" real,
	"curr_value" real,
	"delta_pct" real,
	"window_hours" integer DEFAULT 24 NOT NULL,
	"variants_triggered" boolean DEFAULT false NOT NULL,
	"variants_triggered_at" timestamp with time zone,
	"payload" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promo_events" ADD CONSTRAINT "promo_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promo_events_product_detected_idx" ON "promo_events" USING btree ("product_id","detected_at");--> statement-breakpoint
CREATE INDEX "promo_events_pending_idx" ON "promo_events" USING btree ("variants_triggered","detected_at");--> statement-breakpoint
CREATE INDEX "promo_events_type_idx" ON "promo_events" USING btree ("event_type","detected_at");