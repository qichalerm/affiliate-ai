/**
 * M6 Promo Hunter — Sprint 14.
 *
 * Detects "rising star" signals on products so the variant generator
 * can fast-track content for them. The core insight: products that just
 * had a sudden price drop, discount jump, or sold-count surge convert
 * faster than products on the steady-state queue. Catching them early
 * means our content publishes while the deal is still hot.
 *
 * Signals (each writes its own promo_events row):
 *   - price_drop:     current price ≤ recent floor × (1 - threshold)
 *   - discount_jump:  discount_percent grew ≥ N pp vs prior snapshot
 *   - sold_surge:     sold_count delta over window ≥ recent baseline × N
 *   - new_low:        current price is the lowest on record (within window)
 *
 * Idempotency: only one event per (productId, eventType) within a 6-hour
 * cooldown — re-running the hunter on the same data is a no-op.
 *
 * Output: promo_events rows with variants_triggered=false. A downstream
 * consumer (the variant generator job, or a dedicated trigger loop) reads
 * pending events and produces content. Hunter itself never generates content.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { child } from "../lib/logger.ts";

const log = child("brain.promo-hunter");

// ── Thresholds (env-tunable later) ─────────────────────────────────
/** Min relative drop vs recent floor to count as a price_drop event. */
const PRICE_DROP_THRESHOLD = 0.10;        // 10% extra discount
/** Min absolute jump in discount_percent (pp) to count as discount_jump. */
const DISCOUNT_JUMP_PP = 10;
/** Min sold-count growth multiple over baseline to count as sold_surge. */
const SOLD_SURGE_MULTIPLE = 2.0;
/** Min sold delta (absolute) before considering surge — filter out noise on tiny products. */
const SOLD_SURGE_MIN_DELTA = 5;
/** Cooldown — don't fire same event-type for same product within this window. */
const EVENT_COOLDOWN_HOURS = 6;
/** How far back to look at price history. */
const PRICE_HISTORY_DAYS = 14;

export type PromoEventType = "price_drop" | "discount_jump" | "sold_surge" | "new_low";

export interface PromoHunterResult {
  productsScanned: number;
  eventsDetected: number;
  byType: Record<PromoEventType, number>;
  windowHours: number;
}

interface ProductSnapshot {
  id: number;
  currentPrice: number | null;
  discountPercent: number | null;
  soldCount: number | null;
  lastScrapedAt: Date;
}

interface PriceRow {
  productId: number;
  price: number;
  capturedAt: Date;
}

/**
 * Scan all active products, compare their current state to historical
 * snapshots, and emit promo_events for any that look like rising stars.
 *
 * windowHours: how far back to look for sold-count baseline (default 24).
 */
export async function runPromoHunter(opts: { windowHours?: number } = {}): Promise<PromoHunterResult> {
  const windowHours = opts.windowHours ?? 24;
  const now = Date.now();
  const cooldownCutoff = new Date(now - EVENT_COOLDOWN_HOURS * 60 * 60 * 1000);
  const priceFloorSince = new Date(now - PRICE_HISTORY_DAYS * 24 * 60 * 60 * 1000);

  log.info({ windowHours, priceHistoryDays: PRICE_HISTORY_DAYS }, "promo hunter start");

  const products = await db.query.products.findMany({
    where: (p, { and, eq }) => and(eq(p.isActive, true), eq(p.flagBlacklisted, false)),
    columns: {
      id: true,
      currentPrice: true,
      discountPercent: true,
      soldCount: true,
      lastScrapedAt: true,
    },
  });

  const result: PromoHunterResult = {
    productsScanned: products.length,
    eventsDetected: 0,
    byType: { price_drop: 0, discount_jump: 0, sold_surge: 0, new_low: 0 },
    windowHours,
  };

  for (const p of products as ProductSnapshot[]) {
    if (p.currentPrice == null) continue;

    // Pull historical price points (most recent first)
    const history = await db
      .select({
        price: schema.productPrices.price,
        capturedAt: schema.productPrices.capturedAt,
      })
      .from(schema.productPrices)
      .where(
        and(
          eq(schema.productPrices.productId, p.id),
          gte(schema.productPrices.capturedAt, priceFloorSince),
        ),
      )
      .orderBy(desc(schema.productPrices.capturedAt))
      .limit(50);

    // Pull recent events to enforce cooldown
    const recentEvents = await db
      .select({
        eventType: schema.promoEvents.eventType,
      })
      .from(schema.promoEvents)
      .where(
        and(
          eq(schema.promoEvents.productId, p.id),
          gte(schema.promoEvents.detectedAt, cooldownCutoff),
        ),
      );
    const onCooldown = new Set(recentEvents.map((e) => e.eventType));

    // ── price_drop / new_low ──────────────────────────────────────
    if (history.length >= 2) {
      // Compare against the floor of the prior period (excluding this latest snap)
      const priorPrices = history.slice(1).map((h) => h.price);
      const priorFloor = Math.min(...priorPrices);
      const dropFraction = (priorFloor - p.currentPrice) / priorFloor;

      if (
        priorFloor > 0 &&
        p.currentPrice < priorFloor &&
        dropFraction >= PRICE_DROP_THRESHOLD &&
        !onCooldown.has("price_drop")
      ) {
        await insertEvent({
          productId: p.id,
          eventType: "price_drop",
          signalStrength: clamp01(dropFraction / 0.5),  // a 50% drop = strength 1.0
          prevValue: priorFloor,
          currValue: p.currentPrice,
          deltaPct: -dropFraction * 100,
          windowHours: PRICE_HISTORY_DAYS * 24,
          payload: { samples: priorPrices.length },
        });
        result.byType.price_drop++;
        result.eventsDetected++;
      }

      // new_low: current is strictly below ALL prior history (and not just by noise)
      const allPrior = history.slice(1);
      const isNewLow = allPrior.length >= 3 && allPrior.every((h) => p.currentPrice! < h.price);
      if (isNewLow && !onCooldown.has("new_low")) {
        const oldestPrice = allPrior[allPrior.length - 1].price;
        const lifetimeDrop = (oldestPrice - p.currentPrice) / oldestPrice;
        await insertEvent({
          productId: p.id,
          eventType: "new_low",
          signalStrength: clamp01(lifetimeDrop / 0.4),
          prevValue: oldestPrice,
          currValue: p.currentPrice,
          deltaPct: -lifetimeDrop * 100,
          windowHours: PRICE_HISTORY_DAYS * 24,
          payload: { historyPoints: allPrior.length },
        });
        result.byType.new_low++;
        result.eventsDetected++;
      }
    }

    // ── discount_jump ─────────────────────────────────────────────
    // Compare current discount_percent to the implied discount on the
    // most recent prior price snapshot. (We don't store discount_percent
    // in product_prices, so we approximate via originalPrice on products.)
    if (
      p.discountPercent != null &&
      history.length >= 2 &&
      !onCooldown.has("discount_jump")
    ) {
      // Implied prior discount = (originalPrice - priorPrice) / originalPrice
      // We don't have originalPrice per snapshot, so use originalPrice from
      // the products table (assumed stable) and compare prior snap → current.
      const priorPrice = history[1].price;
      if (priorPrice > p.currentPrice) {
        // Re-derive the deltas using recorded discount_percent vs implied
        // movement. Simpler: pp jump = (1 - currPrice/priorPrice) * 100.
        const impliedJumpPp = ((priorPrice - p.currentPrice) / priorPrice) * 100;
        if (impliedJumpPp >= DISCOUNT_JUMP_PP) {
          await insertEvent({
            productId: p.id,
            eventType: "discount_jump",
            signalStrength: clamp01(impliedJumpPp / 50),  // 50pp jump = max
            prevValue: priorPrice,
            currValue: p.currentPrice,
            deltaPct: impliedJumpPp,
            windowHours: PRICE_HISTORY_DAYS * 24,
            payload: { discountPercentNow: p.discountPercent },
          });
          result.byType.discount_jump++;
          result.eventsDetected++;
        }
      }
    }

    // ── sold_surge ────────────────────────────────────────────────
    // We don't snapshot sold_count over time yet, so sold_surge needs
    // a dedicated source: detect via raw sold_count ≥ baseline × multiple
    // is impossible without history. For now, surge is detected against
    // soldCount30d baseline (already in products table).
    // Skipped — defer until we add sold-count history.
  }

  log.info(
    {
      productsScanned: result.productsScanned,
      eventsDetected: result.eventsDetected,
      byType: result.byType,
    },
    "promo hunter done",
  );

  return result;
}

interface InsertEventInput {
  productId: number;
  eventType: PromoEventType;
  signalStrength: number;
  prevValue: number;
  currValue: number;
  deltaPct: number;
  windowHours: number;
  payload: Record<string, unknown>;
}

async function insertEvent(e: InsertEventInput): Promise<void> {
  await db.insert(schema.promoEvents).values({
    productId: e.productId,
    eventType: e.eventType,
    signalStrength: e.signalStrength,
    prevValue: e.prevValue,
    currValue: e.currValue,
    deltaPct: e.deltaPct,
    windowHours: e.windowHours,
    payload: e.payload,
  });
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Read pending promo events (variants_triggered=false), bounded by limit
 * and ordered by signal strength. Used by variant-trigger consumers.
 */
export async function pendingPromoEvents(opts: { limit?: number } = {}): Promise<
  Array<{
    id: number;
    productId: number;
    eventType: PromoEventType;
    signalStrength: number;
    detectedAt: Date;
  }>
> {
  const limit = opts.limit ?? 20;
  const rows = await db
    .select({
      id: schema.promoEvents.id,
      productId: schema.promoEvents.productId,
      eventType: schema.promoEvents.eventType,
      signalStrength: schema.promoEvents.signalStrength,
      detectedAt: schema.promoEvents.detectedAt,
    })
    .from(schema.promoEvents)
    .where(eq(schema.promoEvents.variantsTriggered, false))
    .orderBy(desc(schema.promoEvents.signalStrength), desc(schema.promoEvents.detectedAt))
    .limit(limit);
  return rows as Array<{
    id: number;
    productId: number;
    eventType: PromoEventType;
    signalStrength: number;
    detectedAt: Date;
  }>;
}

/** Mark events as having been processed (variants generated). */
export async function markPromoEventsTriggered(eventIds: number[]): Promise<void> {
  if (eventIds.length === 0) return;
  await db
    .update(schema.promoEvents)
    .set({ variantsTriggered: true, variantsTriggeredAt: new Date() })
    .where(sql`id = ANY(${sql.raw(`ARRAY[${eventIds.join(",")}]::int[]`)})`);
}
