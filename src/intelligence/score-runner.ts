/**
 * Score runner — re-scores all active products and updates cached scores in DB.
 * Called by cron every 3-6 hours.
 */

import { db, schema } from "../lib/db.ts";
import { eq, sql } from "drizzle-orm";
import { scoreProduct } from "./scoring.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("score-runner");

export interface ScoreRunOptions {
  /** Limit products processed per run (default: all active). */
  limit?: number;
  /** Re-score products last scored more than this minutes ago. */
  staleAfterMin?: number;
}

export async function runScoring(opts: ScoreRunOptions = {}): Promise<{
  scored: number;
  killed: number;
  durationMs: number;
}> {
  const start = Date.now();
  const staleMin = opts.staleAfterMin ?? 180; // 3h

  const products = await db.query.products.findMany({
    where: (p, { and, eq, or, isNull, lt }) =>
      and(
        eq(p.isActive, true),
        or(
          isNull(p.lastScoredAt),
          lt(p.lastScoredAt, sql`now() - interval '${sql.raw(String(staleMin))} minutes'`),
        ),
      ),
    with: { shop: true },
    limit: opts.limit ?? 5000,
  });

  log.info({ count: products.length }, "scoring batch starting");

  let scored = 0;
  let killed = 0;

  // Persist in chunks to keep memory bounded
  const CHUNK = 100;
  for (let i = 0; i < products.length; i += CHUNK) {
    const chunk = products.slice(i, i + CHUNK);
    const updates: Array<Promise<unknown>> = [];

    const historyInserts: Array<typeof schema.productScoreHistory.$inferInsert> = [];

    for (const p of chunk) {
      try {
        const r = scoreProduct({ product: p, shop: p.shop ?? null });

        if (r.killReasons.length > 0) {
          killed++;
          updates.push(
            db
              .update(schema.products)
              .set({
                finalScore: 0,
                lastScoredAt: new Date(),
              })
              .where(eq(schema.products.id, p.id)),
          );
        } else {
          updates.push(
            db
              .update(schema.products)
              .set({
                demandScore: r.demandScore,
                profitabilityScore: r.profitabilityScore,
                seasonalityBoost: r.seasonalityBoost,
                finalScore: r.finalScore,
                effectiveCommissionRate: r.effectiveCommission,
                lastScoredAt: new Date(),
              })
              .where(eq(schema.products.id, p.id)),
          );
          historyInserts.push({
            productId: p.id,
            demandScore: r.demandScore,
            profitabilityScore: r.profitabilityScore,
            seasonalityBoost: r.seasonalityBoost,
            finalScore: r.finalScore,
            estimatedNetPerVisit: r.netPerVisit,
            estimatedCvr: r.estimatedCvr,
          });
          scored++;
        }
      } catch (err) {
        log.warn({ productId: p.id, err: errMsg(err) }, "score failed");
      }
    }

    await Promise.allSettled(updates);
    if (historyInserts.length > 0) {
      try {
        await db.insert(schema.productScoreHistory).values(historyInserts);
      } catch (err) {
        log.warn({ err: errMsg(err) }, "score history insert failed (non-fatal)");
      }
    }
  }

  const durationMs = Date.now() - start;
  log.info({ scored, killed, durationMs }, "scoring batch done");
  return { scored, killed, durationMs };
}
