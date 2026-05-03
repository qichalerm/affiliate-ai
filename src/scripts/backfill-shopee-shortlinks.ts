/**
 * `bun run src/scripts/backfill-shopee-shortlinks.ts`
 *
 * For every affiliate_links row that doesn't yet have a shopeeShortUrl,
 * call Shopee Open Affiliate API to mint one and patch it onto the row.
 * Use this once after SHOPEE_API_KEY/SECRET land in .env to retro-tag
 * all existing links so commission tracking activates immediately on
 * already-published clicks.
 *
 * Rate-limited to ~50 req/min (well under Shopee's ~100/min ballpark).
 * Idempotent — re-runnable.
 */

import { isNull, eq } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { tryGenerateShortLink } from "../affiliate/shopee-api.ts";
import { env } from "../lib/env.ts";
import { sleep } from "../lib/retry.ts";

interface Row { id: number; channel: string; shortId: string; fullUrl: string; campaign: string | null; variant: string | null }

async function main() {
  if (!env.SHOPEE_API_KEY || !env.SHOPEE_API_SECRET) {
    console.error("❌ SHOPEE_API_KEY / SHOPEE_API_SECRET not set in .env");
    console.error("   Apply at https://affiliate.shopee.co.th/open_api first.");
    process.exit(1);
  }

  const pending: Row[] = await db
    .select({
      id: schema.affiliateLinks.id,
      channel: schema.affiliateLinks.channel,
      shortId: schema.affiliateLinks.shortId,
      fullUrl: schema.affiliateLinks.fullUrl,
      campaign: schema.affiliateLinks.campaign,
      variant: schema.affiliateLinks.variant,
    })
    .from(schema.affiliateLinks)
    .where(isNull(schema.affiliateLinks.shopeeShortUrl));

  console.log(`Found ${pending.length} links without shp.ee short URL`);
  if (pending.length === 0) { await closeDb(); process.exit(0); }

  let ok = 0, failed = 0;
  const RATE_DELAY_MS = 1200;  // ~50 req/min

  for (const row of pending) {
    const subIds = [row.channel, row.shortId, row.campaign ?? "", row.variant ?? ""].filter(Boolean);
    const shortLink = await tryGenerateShortLink({ originUrl: row.fullUrl, subIds });
    if (shortLink) {
      await db.update(schema.affiliateLinks)
        .set({ shopeeShortUrl: shortLink })
        .where(eq(schema.affiliateLinks.id, row.id));
      ok++;
      if (ok % 10 === 0) console.log(`  ✓ ${ok}/${pending.length}  (last: ${shortLink})`);
    } else {
      failed++;
    }
    await sleep(RATE_DELAY_MS);
  }

  console.log(`\nDone: ${ok} succeeded, ${failed} failed`);
  await closeDb();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
