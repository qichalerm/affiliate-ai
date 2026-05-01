/**
 * Cloudflare Web Analytics ingestion.
 *
 * Uses Cloudflare GraphQL API to pull page-level traffic.
 *
 * Setup:
 *   - CLOUDFLARE_API_TOKEN must have "Account.Account Analytics:Read" permission
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - The site must be added to Cloudflare with Web Analytics enabled
 *
 * Quota: GraphQL API is generous; we hit it once per day per scope.
 */

import { db, schema } from "../../lib/db.ts";
import { sql } from "drizzle-orm";
import { env } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { errMsg } from "../../lib/retry.ts";

const log = child("analytics.cloudflare");

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

interface CfMetricRow {
  dimensions: { date: string; metric: string };
  // metric values in `sum`
  sum: {
    visits: number;
    pageViews: number;
  };
  // engagement
  count: number; // unique sessions
}

interface GraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        rumPageloadEventsAdaptiveGroups?: Array<{
          dimensions: { date: string; requestPath: string };
          count: number;
          sum: { visits: number };
        }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

export async function ingestCloudflareAnalytics(opts: { days?: number } = {}): Promise<{
  ingested: number;
  skipped: number;
}> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    log.info("CF analytics: token or account id missing; skip");
    return { ingested: 0, skipped: 0 };
  }
  if (!env.DOMAIN_NAME) {
    log.info("CF analytics: DOMAIN_NAME missing; skip");
    return { ingested: 0, skipped: 0 };
  }

  const days = opts.days ?? 3;
  const endDate = isoDate(new Date());
  const startDate = isoDate(addDays(new Date(), -days));

  // GraphQL query for RUM (Real User Monitoring) page loads
  // Dimensions: date + requestPath. Metrics: visits, pageviews.
  const query = `
    query GetPageMetrics($accountTag: string, $start: Date, $end: Date, $domain: string) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          rumPageloadEventsAdaptiveGroups(
            limit: 5000
            filter: {
              date_geq: $start
              date_leq: $end
              requestHost_like: $domain
            }
            orderBy: [date_DESC, count_DESC]
          ) {
            dimensions {
              date
              requestPath
            }
            count
            sum {
              visits
            }
          }
        }
      }
    }
  `;

  let ingested = 0;
  let skipped = 0;

  try {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: env.CLOUDFLARE_ACCOUNT_ID,
          start: startDate,
          end: endDate,
          domain: `%${env.DOMAIN_NAME}%`,
        },
      }),
    });

    const data = (await res.json()) as GraphQLResponse;
    if (data.errors) {
      log.warn({ errors: data.errors }, "CF analytics returned errors");
      return { ingested: 0, skipped: 0 };
    }

    const groups = data.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? [];
    log.info({ rows: groups.length }, "CF analytics rows");

    for (const row of groups) {
      const slug = extractSlugFromPath(row.dimensions.requestPath);
      if (!slug) {
        skipped++;
        continue;
      }
      const page = await db.query.contentPages.findFirst({
        where: (cp, { eq }) => eq(cp.slug, slug),
        columns: { id: true },
      });
      if (!page) {
        skipped++;
        continue;
      }

      try {
        await db
          .insert(schema.pageMetricsDaily)
          .values({
            contentPageId: page.id,
            capturedDate: new Date(row.dimensions.date),
            visits: row.sum.visits,
            pageviews: row.count,
            uniqueVisitors: row.sum.visits, // CF doesn't separate unique unless we use sessions API
          })
          .onConflictDoUpdate({
            target: [
              schema.pageMetricsDaily.contentPageId,
              schema.pageMetricsDaily.capturedDate,
            ],
            set: {
              visits: row.sum.visits,
              pageviews: row.count,
              uniqueVisitors: row.sum.visits,
            },
          });
        ingested++;
      } catch (err) {
        skipped++;
        log.warn({ err: errMsg(err) }, "CF analytics insert failed");
      }
    }
  } catch (err) {
    log.warn({ err: errMsg(err) }, "CF analytics fetch failed");
  }

  log.info({ ingested, skipped }, "CF analytics ingest done");
  return { ingested, skipped };
}

function extractSlugFromPath(path: string): string | null {
  try {
    const segments = decodeURIComponent(path).split("/").filter(Boolean);
    return segments[segments.length - 1] ?? null;
  } catch {
    return null;
  }
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
