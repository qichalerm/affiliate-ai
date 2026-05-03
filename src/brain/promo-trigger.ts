/**
 * Promo → Variant trigger loop (Sprint 14 follow-up).
 *
 * Reads pending promo_events (variants_triggered=false), generates a
 * fresh batch of variants for each event's product, then marks the
 * events as triggered so they don't get processed twice.
 *
 * Pairs with promo-hunter.ts: hunter writes events, trigger consumes
 * them. Kept as separate modules so:
 *   - hunter is fast/idempotent and can run frequently on its own
 *   - trigger can be tuned independently (cost, channels, batch size)
 *
 * Cost model: each event triggers 1 channel × 3 angles = 3 LLM calls
 * + 3 quality-gate calls. Default batch of 5 events per run = ~30 LLM
 * calls/run. At every-30-min cadence: ~1500/day worst case, ~$1-2/day.
 *
 * Force=true on the variant generator because a price drop is exactly
 * the case where stale "regular price" variants are misleading and
 * should be replaced.
 */

import { generateVariants } from "../content/variant-generator.ts";
import {
  pendingPromoEvents,
  markPromoEventsTriggered,
  type PromoEventType,
} from "./promo-hunter.ts";
import type { Platform } from "../quality/platform-rules.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("brain.promo-trigger");

/**
 * Channels we generate variants for on a promo trigger.
 *
 * Excludes web (different cadence — daily SEO build), and shopee_video
 * (no public publish API; semi-manual flow). FB + IG cover the highest-
 * volume push channels; TikTok added once we have video assembly in the
 * variant pipeline.
 */
const TRIGGER_CHANNELS: Platform[] = ["facebook", "instagram"];

export interface PromoTriggerResult {
  eventsProcessed: number;
  variantsGenerated: number;
  variantsApproved: number;
  totalCostUsd: number;
  byEventType: Record<PromoEventType, number>;
}

export async function runPromoTrigger(opts: { batchSize?: number } = {}): Promise<PromoTriggerResult> {
  const batchSize = opts.batchSize ?? 5;

  const events = await pendingPromoEvents({ limit: batchSize });
  log.info({ pending: events.length, batchSize }, "promo trigger start");

  const result: PromoTriggerResult = {
    eventsProcessed: 0,
    variantsGenerated: 0,
    variantsApproved: 0,
    totalCostUsd: 0,
    byEventType: { price_drop: 0, discount_jump: 0, sold_surge: 0, new_low: 0 },
  };

  if (events.length === 0) {
    log.info("no pending promo events");
    return result;
  }

  const triggeredIds: number[] = [];

  for (const event of events) {
    log.info(
      { eventId: event.id, productId: event.productId, type: event.eventType, strength: event.signalStrength.toFixed(2) },
      "processing promo event",
    );

    let eventOk = true;
    for (const channel of TRIGGER_CHANNELS) {
      try {
        const r = await generateVariants({
          productId: event.productId,
          channel,
          force: true,
        });
        result.variantsGenerated += r.generated;
        result.variantsApproved += r.approved;
        result.totalCostUsd += r.totalCostUsd;
      } catch (err) {
        log.error(
          { eventId: event.id, productId: event.productId, channel, err: errMsg(err) },
          "variant gen failed for promo event",
        );
        eventOk = false;
      }
    }

    if (eventOk) {
      triggeredIds.push(event.id);
      result.eventsProcessed++;
      result.byEventType[event.eventType]++;
    }
  }

  if (triggeredIds.length > 0) {
    await markPromoEventsTriggered(triggeredIds);
  }

  log.info(
    {
      eventsProcessed: result.eventsProcessed,
      variantsGenerated: result.variantsGenerated,
      variantsApproved: result.variantsApproved,
      totalCostUsd: result.totalCostUsd.toFixed(6),
      byEventType: result.byEventType,
    },
    "promo trigger done",
  );

  return result;
}
