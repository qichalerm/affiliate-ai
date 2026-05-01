/**
 * `bun run conversions:import path/to/file.csv` — import Shopee conversions from CSV export.
 *
 * Workflow:
 *   1. Login Shopee Affiliate dashboard
 *   2. Reports → Conversion Report → Export CSV
 *   3. Place file on server
 *   4. bun run conversions:import /path/to/file.csv
 */

import { readFile } from "node:fs/promises";
import { importConversionsFromCsv, syncFromShopeeApi } from "../sync/shopee-conversions.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log("Usage: bun run conversions:import <path/to/csv> | --api");
    console.log("");
    console.log("Try API sync:");
    const r = await syncFromShopeeApi();
    console.log(r);
    await closeDb();
    return;
  }

  if (arg === "--api") {
    const r = await syncFromShopeeApi();
    console.log("API sync:", r);
    await closeDb();
    return;
  }

  console.log(`Importing from ${arg}...\n`);
  const csv = await readFile(arg, "utf8");
  const r = await importConversionsFromCsv(csv);
  console.log("");
  console.log(`Imported: ${r.imported}`);
  console.log(`Skipped:  ${r.skipped}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
