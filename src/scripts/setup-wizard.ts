/**
 * `bun run setup` — interactive first-run wizard.
 *
 * Walks operator through:
 *   1. Env validation (which vars are missing)
 *   2. DB connection test + schema push
 *   3. Optional category seed
 *   4. Optional demo data seed (20 sample products without scraping)
 *   5. First scrape test
 *   6. First content generation test
 *   7. Build + summary
 *
 * Each step is skippable if user has already done it.
 */

import { env, can, summarizeCapabilities } from "../lib/env.ts";
import { pingDb, db, schema, closeDb } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { runShopeeScrape } from "../scraper/shopee/runner.ts";
import { generateReviewPage } from "../content/generator.ts";
import { errMsg } from "../lib/retry.ts";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function ok(msg: string) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function warn(msg: string) {
  console.log(`${YELLOW}⚠${RESET} ${msg}`);
}
function err(msg: string) {
  console.log(`${RED}✗${RESET} ${msg}`);
}
function step(n: number, msg: string) {
  console.log(`\n${BOLD}${CYAN}[${n}/7]${RESET} ${BOLD}${msg}${RESET}`);
}
function info(msg: string) {
  console.log(`  ${msg}`);
}

async function prompt(question: string, defaultYes = true): Promise<boolean> {
  process.stdout.write(`${CYAN}?${RESET} ${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `);
  for await (const line of console as unknown as AsyncIterable<string>) {
    const ans = String(line).trim().toLowerCase();
    if (ans === "" || ans === "y" || ans === "yes") return defaultYes ? true : true;
    if (ans === "n" || ans === "no") return false;
    return defaultYes;
  }
  return defaultYes;
}

async function readLine(question: string): Promise<string> {
  process.stdout.write(`${CYAN}?${RESET} ${question} `);
  for await (const line of console as unknown as AsyncIterable<string>) {
    return String(line).trim();
  }
  return "";
}

async function main() {
  console.log(`${BOLD}🚀 Affiliate Bot — First-Run Wizard${RESET}`);
  console.log("");
  console.log("This will walk you through getting the system running.");
  console.log("Each step is independent; you can skip any to retry later.");
  console.log("");

  // === Step 1: Env validation ===
  step(1, "Environment check");
  const required = {
    DATABASE_URL: env.DATABASE_URL && !env.DATABASE_URL.includes("placeholder"),
    ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY,
    TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_OPERATOR_CHAT_ID: !!env.TELEGRAM_OPERATOR_CHAT_ID,
    SHOPEE_AFFILIATE_ID: !!env.SHOPEE_AFFILIATE_ID,
  };
  let allRequired = true;
  for (const [key, present] of Object.entries(required)) {
    if (present) ok(`${key} set`);
    else {
      err(`${key} MISSING`);
      allRequired = false;
    }
  }
  info(`\nCapabilities: ${summarizeCapabilities()}`);

  if (!allRequired) {
    err("\nFix the missing env vars then re-run setup.");
    info("See docs/env-setup.md for instructions.");
    await closeDb();
    process.exit(1);
  }

  // === Step 2: DB connection ===
  step(2, "Database connection");
  const dbOk = await pingDb();
  if (!dbOk) {
    err("Cannot connect to Postgres. Check DATABASE_URL.");
    info("If you haven't created the DB yet:  sudo bash scripts/setup-postgres.sh");
    await closeDb();
    process.exit(1);
  }
  ok("Connected");

  // === Step 3: Schema push ===
  step(3, "Database schema");
  const tablesResult = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
      FROM information_schema.tables
     WHERE table_schema = 'public'
  `);
  const tableCount = tablesResult[0]?.count ?? 0;
  if (tableCount < 18) {
    warn(`Only ${tableCount} tables — schema not fully applied`);
    info("Run:  bun run db:push");
    info("(or)  bun run db:generate && bun run db:migrate");
    if (await prompt("Run db:push now?")) {
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("bun", ["run", "db:push"], { stdio: "inherit" });
      if (result.status !== 0) {
        err("db:push failed");
        await closeDb();
        process.exit(1);
      }
      ok("Schema applied");
    } else {
      info("Skipping. Run later when ready.");
    }
  } else {
    ok(`${tableCount} tables present`);
  }

  // === Step 4: Categories seed ===
  step(4, "Categories seed");
  const catCount = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM categories
  `);
  if ((catCount[0]?.count ?? 0) > 0) {
    ok(`${catCount[0]?.count} categories already seeded`);
  } else {
    if (await prompt("Seed default IT/Gadget categories now?")) {
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("bun", ["run", "db:seed"], { stdio: "inherit" });
      if (result.status === 0) ok("Categories seeded");
      else warn("Seed failed; continue anyway");
    }
  }

  // === Step 5: Test scrape (small) ===
  step(5, "First scrape test");
  if (await prompt("Try scraping 5 products from Shopee now?")) {
    try {
      const r = await runShopeeScrape({
        keyword: "หูฟังบลูทูธ",
        maxProducts: 5,
        fetchDetails: false,
        reviewsPerProduct: 0,
      });
      ok(`Scraped ${r.itemsSucceeded}/${r.itemsAttempted} products`);
    } catch (e) {
      err(`Scrape failed: ${errMsg(e)}`);
      info("This may be a temporary Shopee block — retry in 5min");
    }
  }

  // === Step 6: Test generate ===
  step(6, "First content generation test");
  if (await prompt("Generate 1 review page now? (uses ~$0.001 of Anthropic credit)")) {
    const products = await db.query.products.findFirst({
      orderBy: (p, { desc }) => desc(p.soldCount),
    });
    if (!products) {
      warn("No products in DB — skip");
    } else {
      try {
        const r = await generateReviewPage({ productId: products.id });
        ok(`Generated page #${r.contentPageId} (${r.status}, $${r.costUsd.toFixed(4)})`);
      } catch (e) {
        err(`Generation failed: ${errMsg(e)}`);
      }
    }
  }

  // === Step 7: Summary ===
  step(7, "Setup complete");
  const products = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM products`);
  const pages = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM content_pages WHERE status = 'published'`);

  console.log(`
${GREEN}✓ Setup complete${RESET}

  Products in DB: ${products[0]?.count ?? 0}
  Published pages: ${pages[0]?.count ?? 0}

${BOLD}Next steps:${RESET}
  ${CYAN}bun run scrape:trending${RESET}  Schedule trending products into DB
  ${CYAN}bun run generate:once 20${RESET}  Generate 20 review pages
  ${CYAN}bun run build:pages${RESET}      Build Astro site + deploy to Cloudflare
  ${CYAN}bun run scheduler:start${RESET}  Start the cron daemon (or use systemd)

${BOLD}Health check:${RESET}
  ${CYAN}bun run doctor${RESET}  comprehensive diagnostic
  ${CYAN}bun run smoke${RESET}   10-test smoke suite
  ${CYAN}bun run stats${RESET}   system stats summary
`);

  await closeDb();
}

main().catch(async (e) => {
  console.error(`\n${RED}Setup wizard crashed:${RESET}`, e);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
