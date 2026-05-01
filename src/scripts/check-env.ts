/**
 * `bun run check-env` — verify .env is properly populated for the current phase.
 * Exits 0 if all required vars present, 1 otherwise.
 */

import { env, summarizeCapabilities, can } from "../lib/env.ts";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface Check {
  name: string;
  present: boolean;
  required: boolean;
  hint?: string;
  phase: 1 | 2 | 3;
}

const checks: Check[] = [
  // Phase 1
  {
    name: "DOMAIN_NAME",
    present: !!env.DOMAIN_NAME && env.DOMAIN_NAME !== "yourdomain.com",
    required: true,
    phase: 1,
    hint: "Buy a domain (Cloudflare Registrar) and set DOMAIN_NAME",
  },
  {
    name: "DATABASE_URL",
    present: !env.DATABASE_URL.includes("placeholder"),
    required: true,
    phase: 1,
    hint: "Sign up at https://neon.tech and paste connection string",
  },
  {
    name: "ANTHROPIC_API_KEY",
    present: !!env.ANTHROPIC_API_KEY,
    required: true,
    phase: 1,
    hint: "Get key at https://console.anthropic.com",
  },
  {
    name: "SHOPEE_AFFILIATE_ID",
    present: !!env.SHOPEE_AFFILIATE_ID,
    required: true,
    phase: 1,
    hint: "Sign up at https://affiliate.shopee.co.th/",
  },
  {
    name: "TELEGRAM_BOT_TOKEN",
    present: !!env.TELEGRAM_BOT_TOKEN,
    required: true,
    phase: 1,
    hint: "Talk to @BotFather on Telegram",
  },
  {
    name: "TELEGRAM_OPERATOR_CHAT_ID",
    present: !!env.TELEGRAM_OPERATOR_CHAT_ID,
    required: true,
    phase: 1,
    hint: "Talk to @userinfobot on Telegram",
  },
  {
    name: "CLOUDFLARE_API_TOKEN",
    present: !!env.CLOUDFLARE_API_TOKEN,
    required: true,
    phase: 1,
    hint: "Create token at https://dash.cloudflare.com → My Profile → API Tokens",
  },
  {
    name: "GITHUB_TOKEN",
    present: !!env.GITHUB_TOKEN,
    required: true,
    phase: 1,
    hint: "Create at GitHub → Settings → Developer settings → Personal access tokens",
  },

  // Phase 2
  {
    name: "TELEGRAM_DEAL_CHANNEL_ID",
    present: !!env.TELEGRAM_DEAL_CHANNEL_ID,
    required: false,
    phase: 2,
    hint: "Create a public Telegram channel, add bot as admin",
  },
  {
    name: "PINTEREST_ACCESS_TOKEN",
    present: !!env.PINTEREST_ACCESS_TOKEN,
    required: false,
    phase: 2,
    hint: "https://developers.pinterest.com",
  },
  {
    name: "ELEVENLABS_API_KEY",
    present: !!env.ELEVENLABS_API_KEY,
    required: false,
    phase: 2,
    hint: "https://elevenlabs.io for voice generation",
  },
  {
    name: "FASTMOSS_API_KEY",
    present: !!env.FASTMOSS_API_KEY,
    required: false,
    phase: 2,
    hint: "https://fastmoss.com for TikTok product trends",
  },
  {
    name: "WEBSHARE_API_KEY",
    present: !!env.WEBSHARE_API_KEY,
    required: false,
    phase: 2,
    hint: "https://webshare.io for residential proxies",
  },

  // Phase 3
  {
    name: "TIKTOK_ACCESS_TOKEN",
    present: !!env.TIKTOK_ACCESS_TOKEN,
    required: false,
    phase: 3,
    hint: "https://developers.tiktok.com (review takes 2-4 weeks)",
  },
  {
    name: "META_PAGE_ACCESS_TOKEN",
    present: !!env.META_PAGE_ACCESS_TOKEN,
    required: false,
    phase: 3,
    hint: "https://developers.facebook.com",
  },
  {
    name: "FLUX_API_KEY",
    present: !!(env.FLUX_API_KEY || env.REPLICATE_API_TOKEN),
    required: false,
    phase: 3,
    hint: "Replicate or Flux directly for image generation",
  },
];

console.log(`${BOLD}${BLUE}=== Environment Check ===${RESET}\n`);
console.log(`Niche: ${BOLD}${env.PRIMARY_NICHE}${RESET}`);
console.log(`Posting mode: ${BOLD}${env.POSTING_MODE}${RESET}`);
console.log(`Dry run: ${env.DEBUG_DRY_RUN ? `${YELLOW}YES${RESET}` : `${GREEN}NO${RESET}`}`);
console.log("");

const phases: Array<1 | 2 | 3> = [1, 2, 3];
const phaseNames = { 1: "Phase 1 (foundation)", 2: "Phase 2 (scale)", 3: "Phase 3 (social)" };
let phase1Failures = 0;

for (const phase of phases) {
  const phaseChecks = checks.filter((c) => c.phase === phase);
  console.log(`${BOLD}${phaseNames[phase]}${RESET}`);
  for (const c of phaseChecks) {
    const icon = c.present ? `${GREEN}✓${RESET}` : c.required ? `${RED}✗${RESET}` : `${YELLOW}·${RESET}`;
    const status = c.required ? "REQUIRED" : "optional";
    console.log(`  ${icon} ${c.name.padEnd(30)} ${c.present ? "set" : `MISSING (${status})`}`);
    if (!c.present && c.hint) {
      console.log(`     ${BLUE}↳${RESET} ${c.hint}`);
    }
    if (!c.present && c.required && phase === 1) phase1Failures++;
  }
  console.log("");
}

console.log(`${BOLD}Capabilities:${RESET}`);
console.log(`  ${summarizeCapabilities()}`);
console.log("");

if (phase1Failures > 0) {
  console.log(`${RED}${BOLD}❌ ${phase1Failures} required Phase-1 vars missing.${RESET}`);
  console.log(`${YELLOW}   See docs/env-setup.md for setup instructions.${RESET}`);
  process.exit(1);
}

console.log(`${GREEN}${BOLD}✅ Phase 1 ready — you can run db:push, scrape:once, generate:once${RESET}`);

// Layer-flag warnings (informational)
if (env.FEATURE_TIKTOK_AUTO_POST && !can.postTikTok()) {
  console.log(`${YELLOW}⚠ FEATURE_TIKTOK_AUTO_POST=true but TIKTOK_ACCESS_TOKEN missing${RESET}`);
}
if (env.FEATURE_META_AUTO_POST && !can.postMeta()) {
  console.log(`${YELLOW}⚠ FEATURE_META_AUTO_POST=true but META_PAGE_ACCESS_TOKEN missing${RESET}`);
}

process.exit(0);
