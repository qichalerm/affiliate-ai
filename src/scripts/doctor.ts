/**
 * `bun run doctor` — comprehensive system diagnostic with remediation hints.
 *
 * Different from smoke-test (which just checks "does it work"):
 *   - doctor explains WHY something is wrong + HOW to fix
 *   - covers operational concerns: stale data, drift, missing config
 *   - safe to run anytime
 */

import { db, pingDb, closeDb } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { env, can } from "../lib/env.ts";
import { allBreakerStatus } from "../lib/circuit-breaker.ts";
import { errMsg } from "../lib/retry.ts";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

interface Diagnosis {
  category: string;
  status: "ok" | "warn" | "error" | "info";
  title: string;
  detail?: string;
  fix?: string;
}

const findings: Diagnosis[] = [];

function record(d: Diagnosis): void {
  findings.push(d);
}

async function checkEnv() {
  // Required Phase 1
  const required = [
    { name: "DOMAIN_NAME", val: env.DOMAIN_NAME, isPlaceholder: env.DOMAIN_NAME === "yourdomain.com" },
    { name: "DATABASE_URL", val: env.DATABASE_URL, isPlaceholder: env.DATABASE_URL.includes("placeholder") },
    { name: "ANTHROPIC_API_KEY", val: env.ANTHROPIC_API_KEY, isPlaceholder: false },
    { name: "TELEGRAM_BOT_TOKEN", val: env.TELEGRAM_BOT_TOKEN, isPlaceholder: false },
    { name: "TELEGRAM_OPERATOR_CHAT_ID", val: env.TELEGRAM_OPERATOR_CHAT_ID, isPlaceholder: false },
    { name: "SHOPEE_AFFILIATE_ID", val: env.SHOPEE_AFFILIATE_ID, isPlaceholder: false },
  ];
  for (const r of required) {
    if (!r.val || r.isPlaceholder) {
      record({
        category: "env",
        status: "error",
        title: `${r.name} not configured`,
        fix: `Set ${r.name} in .env (see docs/env-setup.md)`,
      });
    }
  }
  if (required.every((r) => r.val && !r.isPlaceholder)) {
    record({ category: "env", status: "ok", title: "Phase 1 env complete" });
  }

  // Optional that improve quality
  if (!env.PINTEREST_ACCESS_TOKEN) {
    record({
      category: "env",
      status: "info",
      title: "Pinterest disabled",
      fix: "Set PINTEREST_ACCESS_TOKEN to enable auto-pinning (free, low ban risk)",
    });
  }
  if (!env.SHORTIO_API_KEY && !env.BITLY_TOKEN) {
    record({
      category: "env",
      status: "warn",
      title: "Link shortener missing",
      fix: "Set SHORTIO_API_KEY for branded short links (improves CTR + click tracking)",
    });
  }
  if (!env.SENTRY_DSN) {
    record({
      category: "env",
      status: "warn",
      title: "Error tracking disabled",
      fix: "Set SENTRY_DSN — errors get logged but no aggregation/alerts",
    });
  }
  if (!env.RESEND_API_KEY) {
    record({
      category: "env",
      status: "info",
      title: "Email disabled",
      fix: "Set RESEND_API_KEY for newsletter + email alerts (free 3k/mo)",
    });
  }
  if (!env.WEBSHARE_API_KEY) {
    record({
      category: "env",
      status: "info",
      title: "Proxy not configured",
      fix: "Set WEBSHARE_API_KEY when scraper hits Shopee block",
    });
  }
}

async function checkDb() {
  const dbOk = await pingDb();
  if (!dbOk) {
    record({
      category: "db",
      status: "error",
      title: "DB unreachable",
      fix: "Check DATABASE_URL; if self-host: sudo bash scripts/setup-postgres.sh",
    });
    return;
  }

  // Schema completeness
  const tables = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
      FROM information_schema.tables WHERE table_schema = 'public'
  `);
  const tableCount = tables[0]?.count ?? 0;
  if (tableCount < 18) {
    record({
      category: "db",
      status: "error",
      title: `Schema incomplete (${tableCount} tables, expected ≥ 18)`,
      fix: "Run: bun run db:push",
    });
  } else {
    record({ category: "db", status: "ok", title: `Schema OK (${tableCount} tables)` });
  }

  // DB size
  const size = await db.execute<{ size: string }>(sql`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `);
  record({
    category: "db",
    status: "info",
    title: `DB size: ${size[0]?.size ?? "?"}`,
  });

  // Categories seeded?
  const catCount = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM categories`);
  if ((catCount[0]?.count ?? 0) === 0) {
    record({
      category: "db",
      status: "warn",
      title: "No categories seeded",
      fix: "Run: bun run db:seed",
    });
  }
}

async function checkContent() {
  const products = await db.execute<{ count: number; shopee: number; lazada: number }>(sql`
    SELECT COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE platform = 'shopee')::int AS shopee,
           COUNT(*) FILTER (WHERE platform = 'lazada')::int AS lazada
      FROM products WHERE is_active = true
  `);
  const p = products[0]!;

  if (p.count === 0) {
    record({
      category: "content",
      status: "warn",
      title: "No products scraped yet",
      fix: "Run: bun run scrape:once 'หูฟังบลูทูธ' 30  (or  bun run db:seed-demo for demo data)",
    });
    return;
  }

  record({
    category: "content",
    status: "ok",
    title: `${p.count} products (Shopee: ${p.shopee}, Lazada: ${p.lazada})`,
  });

  if (p.lazada === 0) {
    record({
      category: "content",
      status: "info",
      title: "No Lazada products",
      fix: "Enable: bun run scrape:lazada 'wireless earbuds' 2",
    });
  }

  // Pages by type
  const pages = await db.execute<{
    type: string;
    count: number;
  }>(sql`
    SELECT type::text AS type, COUNT(*)::int AS count
      FROM content_pages WHERE status = 'published'
     GROUP BY type
  `);
  const total = pages.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    record({
      category: "content",
      status: "warn",
      title: "No published pages",
      fix: "Run: bun run generate:once 10",
    });
  } else {
    record({
      category: "content",
      status: "ok",
      title: `${total} published pages: ${pages.map((p) => `${p.type}=${p.count}`).join(", ")}`,
    });
  }

  // Stale scoring?
  const stale = await db.execute<{ stale: number }>(sql`
    SELECT COUNT(*)::int AS stale
      FROM products
     WHERE is_active = true
       AND (last_scored_at IS NULL OR last_scored_at < now() - interval '24 hours')
  `);
  if ((stale[0]?.stale ?? 0) > p.count * 0.5) {
    record({
      category: "content",
      status: "warn",
      title: `${stale[0]?.stale} products with stale scoring`,
      fix: "Run: bun run score:once",
    });
  }
}

async function checkOperations() {
  // Recent scrape success rate
  const scrape = await db.execute<{ total: number; ok: number }>(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'success')::int AS ok
      FROM scraper_runs WHERE started_at > now() - interval '24 hours'
  `);
  const s = scrape[0];
  if (s && s.total > 0) {
    const rate = (s.ok / s.total) * 100;
    if (rate < 50) {
      record({
        category: "ops",
        status: "error",
        title: `Scrape success rate ${rate.toFixed(0)}% (last 24h)`,
        fix: "Check Sentry/logs; if Shopee blocking: enable Webshare proxy",
      });
    } else if (rate < 80) {
      record({
        category: "ops",
        status: "warn",
        title: `Scrape success rate ${rate.toFixed(0)}% (last 24h)`,
        fix: "Some failures normal; investigate if persists",
      });
    } else {
      record({
        category: "ops",
        status: "ok",
        title: `Scrape healthy: ${rate.toFixed(0)}% success`,
      });
    }
  }

  // LLM budget
  const cost = await db.execute<{ cost: number }>(sql`
    SELECT COALESCE(SUM(cost_usd), 0)::float AS cost
      FROM generation_runs WHERE started_at::date = current_date
  `);
  const todayCost = cost[0]?.cost ?? 0;
  const budget = env.DAILY_LLM_BUDGET_USD;
  if (todayCost > budget) {
    record({
      category: "ops",
      status: "error",
      title: `LLM cost today $${todayCost.toFixed(2)} > budget $${budget}`,
      fix: "Increase DAILY_LLM_BUDGET_USD or reduce content gen frequency",
    });
  } else if (todayCost > budget * 0.8) {
    record({
      category: "ops",
      status: "warn",
      title: `LLM cost today $${todayCost.toFixed(2)} / $${budget} (${((todayCost / budget) * 100).toFixed(0)}%)`,
    });
  }

  // Alerts backlog
  const alerts = await db.execute<{ unresolved: number; needs_action: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS unresolved,
           COUNT(*) FILTER (WHERE resolved_at IS NULL AND requires_user_action)::int AS needs_action
      FROM alerts
  `);
  const a = alerts[0];
  if (a && a.needs_action > 0) {
    record({
      category: "ops",
      status: "warn",
      title: `${a.needs_action} alerts need your decision`,
      fix: "Review: SELECT * FROM alerts WHERE resolved_at IS NULL AND requires_user_action ORDER BY created_at DESC",
    });
  }
}

async function checkBreakers() {
  const breakers = allBreakerStatus();
  const open = Object.entries(breakers).filter(([, s]) => s.state === "OPEN");
  if (open.length > 0) {
    record({
      category: "ops",
      status: "error",
      title: `Circuit breakers OPEN: ${open.map(([n]) => n).join(", ")}`,
      fix: "Service failing fast. Check upstream service health.",
    });
  }
}

async function main() {
  console.log(`${BOLD}🩺 Affiliate Bot — Doctor${RESET}\n`);

  await checkEnv();
  await checkDb();
  if (findings.some((f) => f.category === "db" && f.status === "error")) {
    // DB unreachable — skip downstream checks
  } else {
    await checkContent();
    await checkOperations();
    await checkBreakers();
  }

  // Print results grouped by category
  const categories = ["env", "db", "content", "ops"];
  for (const cat of categories) {
    const items = findings.filter((f) => f.category === cat);
    if (items.length === 0) continue;
    console.log(`${BOLD}${CYAN}${cat.toUpperCase()}${RESET}`);
    for (const item of items) {
      const icon = {
        ok: `${GREEN}✓${RESET}`,
        warn: `${YELLOW}⚠${RESET}`,
        error: `${RED}✗${RESET}`,
        info: `${CYAN}·${RESET}`,
      }[item.status];
      console.log(`  ${icon} ${item.title}`);
      if (item.detail) console.log(`     ${item.detail}`);
      if (item.fix) console.log(`     ${YELLOW}→${RESET} ${item.fix}`);
    }
    console.log("");
  }

  const errorCount = findings.filter((f) => f.status === "error").length;
  const warnCount = findings.filter((f) => f.status === "warn").length;

  if (errorCount === 0 && warnCount === 0) {
    console.log(`${GREEN}${BOLD}🎉 All checks passed${RESET}\n`);
  } else {
    console.log(
      `${errorCount > 0 ? RED : YELLOW}${BOLD}` +
        `${errorCount} errors, ${warnCount} warnings${RESET}\n`,
    );
  }

  await closeDb();
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Doctor crashed:", errMsg(e));
  await closeDb().catch(() => undefined);
  process.exit(2);
});
