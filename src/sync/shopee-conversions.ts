/**
 * Shopee Affiliate conversion sync.
 *
 * Pulls commission/conversion data from Shopee Affiliate API and writes to
 * the conversions table → ground truth for revenue, attribution, and ML.
 *
 * Two pathways:
 *   1. Official Shopee Marketing Solutions API (requires SHOPEE_API_KEY/SECRET)
 *   2. CSV manual import (download from Shopee Affiliate dashboard)
 *
 * Phase 1: only #2 works (no API access yet). Code is structured so #1 can
 * be enabled when keys are obtained.
 */

import { db, schema } from "../lib/db.ts";
import { eq } from "drizzle-orm";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("sync.shopee-conversions");

export interface ConversionRecord {
  externalOrderId: string;
  affiliateLinkSubId?: string;
  productExternalId?: string;
  isIndirect: boolean;
  quantitySold: number;
  grossSatang: number;
  commissionSatang: number;
  commissionRate: number;
  isRefunded: boolean;
  orderedAt: Date;
  raw: unknown;
}

/**
 * Persist one conversion (idempotent via externalOrderId).
 */
export async function persistConversion(c: ConversionRecord): Promise<void> {
  // Resolve affiliate_link_id by sub_id if provided
  let affiliateLinkId: number | null = null;
  if (c.affiliateLinkSubId) {
    const link = await db.query.affiliateLinks.findFirst({
      where: eq(schema.affiliateLinks.subId, c.affiliateLinkSubId),
      columns: { id: true },
    });
    affiliateLinkId = link?.id ?? null;
  }

  // Resolve productId by externalId
  let productId: number | null = null;
  if (c.productExternalId) {
    const product = await db.query.products.findFirst({
      where: (p, { and, eq }) =>
        and(eq(p.platform, "shopee"), eq(p.externalId, c.productExternalId!)),
      columns: { id: true },
    });
    productId = product?.id ?? null;
  }

  await db
    .insert(schema.conversions)
    .values({
      affiliateLinkId,
      externalOrderId: c.externalOrderId,
      productId,
      isIndirect: c.isIndirect,
      quantitySold: c.quantitySold,
      grossSatang: c.grossSatang,
      commissionSatang: c.commissionSatang,
      commissionRate: c.commissionRate,
      isRefunded: c.isRefunded,
      orderedAt: c.orderedAt,
      raw: c.raw as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: schema.conversions.externalOrderId,
      set: {
        commissionSatang: c.commissionSatang,
        isRefunded: c.isRefunded,
      },
    });
}

/**
 * Pull conversions from Shopee API (requires API key approval).
 * Stub for now — implementation depends on Shopee's actual Marketing Solutions API
 * which we'd hit once we have credentials.
 */
export async function syncFromShopeeApi(): Promise<{
  synced: number;
  skipped: number;
  error?: string;
}> {
  if (!env.SHOPEE_API_KEY || !env.SHOPEE_API_SECRET) {
    log.info("SHOPEE_API_KEY not configured — skipping API sync (use CSV import instead)");
    return { synced: 0, skipped: 0, error: "no-api-key" };
  }
  // TODO: implement Shopee Marketing Solutions API call when credentials available
  // Endpoint: https://partner.shopeemobile.com/api/v2/affiliate/...
  log.warn("Shopee API conversion sync not yet implemented");
  return { synced: 0, skipped: 0, error: "not-implemented" };
}

/**
 * Import conversions from CSV (downloaded manually from Shopee dashboard).
 * Expected columns (English Shopee dashboard export):
 *   Order ID | Order Time | Sub ID 1 | Item ID | Quantity |
 *   Gross Sales | Commission | Commission Rate | Order Status
 */
export async function importConversionsFromCsv(csvText: string): Promise<{
  imported: number;
  skipped: number;
}> {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { imported: 0, skipped: 0 };

  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const idx = (key: string) => header.findIndex((h) => h.includes(key));

  const colOrderId = idx("order id");
  const colOrderTime = idx("order time");
  const colSubId = idx("sub id");
  const colItemId = idx("item id");
  const colQuantity = idx("quantity");
  const colGross = idx("gross");
  const colCommission = idx("commission");
  const colCommRate = idx("commission rate");
  const colStatus = idx("status");

  if (colOrderId < 0) {
    throw new Error(`CSV missing required column 'order id'. Got: ${header.join(", ")}`);
  }

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    try {
      const grossBaht = Number.parseFloat(cells[colGross] ?? "0");
      const commBaht = Number.parseFloat(cells[colCommission] ?? "0");
      const status = (cells[colStatus] ?? "").toLowerCase();
      await persistConversion({
        externalOrderId: cells[colOrderId] ?? "",
        affiliateLinkSubId: colSubId >= 0 ? cells[colSubId] : undefined,
        productExternalId: colItemId >= 0 ? cells[colItemId] : undefined,
        isIndirect: false,
        quantitySold: colQuantity >= 0 ? Number.parseInt(cells[colQuantity] ?? "1", 10) : 1,
        grossSatang: Math.round(grossBaht * 100),
        commissionSatang: Math.round(commBaht * 100),
        commissionRate: colCommRate >= 0 ? Number.parseFloat(cells[colCommRate] ?? "0") / 100 : 0,
        isRefunded: status.includes("cancel") || status.includes("refund"),
        orderedAt: colOrderTime >= 0 ? new Date(cells[colOrderTime] ?? Date.now()) : new Date(),
        raw: { csvRow: cells },
      });
      imported++;
    } catch (err) {
      skipped++;
      log.warn({ row: i, err: errMsg(err) }, "csv row failed");
    }
  }

  log.info({ imported, skipped }, "csv import done");
  return { imported, skipped };
}

/** Tiny CSV parser — handles quoted commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}
