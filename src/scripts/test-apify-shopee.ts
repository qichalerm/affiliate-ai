/**
 * `bun run src/scripts/test-apify-shopee.ts` — verify Apify Shopee scraper works.
 *
 * Tests xtracto/shopee-scraper first (cheap, HTTP-only, $0.01/result).
 * Falls back to fatihtahta/shopee-scraper (popular, 4.9★, 516 users) if needed.
 *
 * Output: success rate, sample item, cost estimate per 1k products.
 */

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error(`${RED}✗ APIFY_TOKEN missing in .env${RESET}`);
  process.exit(1);
}

const ACTOR = process.env.APIFY_ACTOR ?? "xtracto/shopee-scraper";
const ACTOR_PATH = ACTOR.replace("/", "~");

interface ApifyRun {
  id: string;
  status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMING-OUT" | "TIMED-OUT" | "ABORTING" | "ABORTED";
  defaultDatasetId: string;
  startedAt: string;
  finishedAt?: string;
  stats?: { computeUnits?: number };
  usage?: { ACTOR_COMPUTE_UNITS?: number; DATASET_WRITES?: number };
  usageTotalUsd?: number;
}

async function startRun(input: unknown): Promise<ApifyRun> {
  const url = `https://api.apify.com/v2/acts/${ACTOR_PATH}/runs?token=${TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`startRun ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data: ApifyRun };
  return json.data;
}

async function getRun(runId: string): Promise<ApifyRun> {
  const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${TOKEN}`);
  if (!res.ok) throw new Error(`getRun ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: ApifyRun };
  return json.data;
}

async function getDataset(datasetId: string, limit = 10): Promise<unknown[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=1&limit=${limit}&token=${TOKEN}`,
  );
  if (!res.ok) throw new Error(`getDataset ${res.status}: ${await res.text()}`);
  return (await res.json()) as unknown[];
}

async function waitForRun(runId: string, timeoutMs = 240_000): Promise<ApifyRun> {
  const t0 = Date.now();
  let lastStatus = "";
  while (Date.now() - t0 < timeoutMs) {
    const run = await getRun(runId);
    if (run.status !== lastStatus) {
      console.log(`  ${DIM}status: ${run.status} (${((Date.now() - t0) / 1000).toFixed(0)}s)${RESET}`);
      lastStatus = run.status;
    }
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`run ${runId} timeout`);
}

async function smokeTest() {
  console.log(`${YELLOW}=== Apify Shopee scraper smoke test ===${RESET}`);
  console.log(`${DIM}Actor: ${ACTOR}${RESET}\n`);

  // xtracto/shopee-scraper input schema (per https://apify.com/xtracto/shopee-scraper)
  const input = {
    country: "th",
    mode: "keyword",
    keyword: "iphone",
    maxProducts: 5,
    sort: "sales",
    delay: 1.0,
    fetchDetail: false,
  };

  console.log(`${YELLOW}[1]${RESET} Starting run with input:`);
  console.log(`  ${DIM}${JSON.stringify(input)}${RESET}\n`);

  let run: ApifyRun;
  try {
    run = await startRun(input);
    console.log(`  ${GREEN}✓${RESET} Run started: ${run.id}\n`);
  } catch (err) {
    console.log(`  ${RED}✗ ${(err as Error).message}${RESET}`);
    process.exit(1);
  }

  console.log(`${YELLOW}[2]${RESET} Polling run...`);
  const finished = await waitForRun(run.id, 240_000);
  console.log(
    `  Final: ${finished.status === "SUCCEEDED" ? GREEN : RED}${finished.status}${RESET}  cost=$${(finished.usageTotalUsd ?? 0).toFixed(4)}\n`,
  );

  console.log(`${YELLOW}[3]${RESET} Fetching dataset (first 10 items)...`);
  const items = await getDataset(finished.defaultDatasetId, 10);
  console.log(`  Got ${items.length} items`);

  if (items.length > 0) {
    const sample = items[0] as Record<string, unknown>;
    console.log(`\n${YELLOW}[4]${RESET} Sample item — fields:`);
    const keys = Object.keys(sample).slice(0, 18);
    for (const k of keys) {
      const v = sample[k];
      const preview =
        typeof v === "string"
          ? v.slice(0, 60)
          : typeof v === "object" && v !== null
            ? Array.isArray(v)
              ? `[${(v as unknown[]).length} items]`
              : `{${Object.keys(v as object).slice(0, 4).join(",")}...}`
            : String(v);
      console.log(`  ${k}: ${DIM}${preview}${RESET}`);
    }

    const cost = finished.usageTotalUsd ?? 0;
    const perItem = items.length > 0 ? cost / items.length : 0;
    console.log(
      `\n${GREEN}✓ Apify Shopee works.${RESET}  cost=$${cost.toFixed(4)} for ${items.length} items  (=$${(perItem * 1000).toFixed(2)}/1k)`,
    );
    process.exit(0);
  } else {
    console.log(`\n${RED}✗ Run succeeded but returned 0 items.${RESET}`);
    console.log(`${YELLOW}Likely fix: input shape mismatch — check actor's README at https://apify.com/${ACTOR}${RESET}`);
    process.exit(2);
  }
}

smokeTest().catch((err) => {
  console.error(`${RED}Fatal: ${err instanceof Error ? err.message : err}${RESET}`);
  process.exit(1);
});
