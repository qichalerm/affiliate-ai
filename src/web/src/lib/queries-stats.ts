/**
 * Site-wide stats queries (homepage trust band).
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

export interface SiteStats {
  productCount: number;
  lastUpdate: Date | null;
  maxDiscountPercent: number | null;
}

export async function getSiteStats(): Promise<SiteStats> {
  try {
    const rows = await db.execute<{
      product_count: number;
      last_update: Date | null;
      max_discount: number | null;
    }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM products WHERE is_active = true) AS product_count,
        (SELECT MAX(last_scraped_at) FROM products) AS last_update,
        (SELECT MAX(discount_percent) FROM products
          WHERE is_active = true AND discount_percent IS NOT NULL) AS max_discount
    `);
    const r = rows[0];
    return {
      productCount: Number(r?.product_count ?? 0),
      lastUpdate: r?.last_update ? new Date(r.last_update) : null,
      maxDiscountPercent: r?.max_discount ? Number(r.max_discount) : null,
    };
  } catch {
    return { productCount: 0, lastUpdate: null, maxDiscountPercent: null };
  }
}
