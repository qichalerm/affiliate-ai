/**
 * Environment validation with Zod.
 * Loads .env, validates types/defaults, exposes typed `env` object + `can` capability checks.
 */

import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env" });

const optStr = z.string().optional().or(z.literal("").transform(() => undefined));
const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  // Core
  DOMAIN_NAME: z.string().default("price-th.com"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TIMEZONE: z.string().default("Asia/Bangkok"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),

  // Affiliate
  SHOPEE_AFFILIATE_ID: optStr,
  SHOPEE_API_KEY: optStr,
  SHOPEE_API_SECRET: optStr,
  SHOPEE_TRACKING_ID: optStr,
  TIKTOK_SHOP_AFFILIATE_ID: optStr,
  TIKTOK_SHOP_API_KEY: optStr,
  /** Apify actor id for TikTok Shop scraping. When unset, the TikTok
   * Shop scrape job is a no-op. Pick one from
   * https://apify.com/store?search=tiktok+shop and paste here. */
  TIKTOK_SHOP_ACTOR_ID: optStr,

  // Apify
  APIFY_TOKEN: optStr,
  APIFY_ACTOR_SHOPEE: z.string().default("xtracto/shopee-scraper"),
  APIFY_MEMORY_MB: z.coerce.number().int().positive().default(2048),
  APIFY_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(2.0),

  // AI
  ANTHROPIC_API_KEY: optStr,
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-4-5-20251001"),
  ANTHROPIC_MODEL_SMART: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_MODEL_PRO: z.string().default("claude-opus-4-7"),

  ELEVENLABS_API_KEY: optStr,
  ELEVENLABS_VOICE_ID: optStr,
  ELEVENLABS_MODEL: z.string().default("eleven_multilingual_v3"),

  REPLICATE_API_TOKEN: optStr,
  FLUX_API_KEY: optStr,
  KLING_API_KEY: optStr,
  SORA_API_KEY: optStr,
  RUNWAY_API_KEY: optStr,
  SUBMAGIC_API_KEY: optStr,

  // Cloudflare
  CLOUDFLARE_ACCOUNT_ID: optStr,
  CLOUDFLARE_API_TOKEN: optStr,
  CLOUDFLARE_ZONE_ID: optStr,
  CLOUDFLARE_PAGES_PROJECT: z.string().default("shopee-aggregator"),

  // Public site config (used by site builder + deployer)
  SITE_DOMAIN: z.string().default("price-th.com"),
  SITE_NAME: z.string().default("Price-TH Deals"),
  SITE_OUT_DIR: z.string().default("./dist"),
  /** Set true to auto-deploy to Cloudflare Pages after every site rebuild. */
  AUTO_DEPLOY_AFTER_REBUILD: z.string().default("true").transform((v) => v === "true"),

  R2_ACCOUNT_ID: optStr,
  R2_ACCESS_KEY_ID: optStr,
  R2_SECRET_ACCESS_KEY: optStr,
  R2_BUCKET_NAME: z.string().default("affiliate-assets"),

  // GitHub
  GITHUB_TOKEN: optStr,
  GITHUB_REPO: optStr,

  // SEO
  GOOGLE_OAUTH_CLIENT_ID: optStr,
  GOOGLE_OAUTH_CLIENT_SECRET: optStr,
  GOOGLE_OAUTH_REFRESH_TOKEN: optStr,
  GOOGLE_SEARCH_CONSOLE_PROPERTY: optStr,
  BING_INDEXNOW_KEY: optStr,

  // Social
  META_APP_ID: optStr,
  META_APP_SECRET: optStr,
  META_PAGE_ID: optStr,
  META_PAGE_ACCESS_TOKEN: optStr,
  META_INSTAGRAM_BUSINESS_ID: optStr,

  TIKTOK_CLIENT_KEY: optStr,
  TIKTOK_CLIENT_SECRET: optStr,
  TIKTOK_ACCESS_TOKEN: optStr,
  TIKTOK_REFRESH_TOKEN: optStr,
  TIKTOK_OPEN_ID: optStr,

  // Operations
  RESEND_API_KEY: optStr,
  EMAIL_FROM: optStr,
  OPERATOR_EMAIL: optStr,
  SENTRY_DSN: optStr,

  // Niche / scrape
  PRIMARY_NICHE: z.string().default("all"),
  SCRAPE_KEYWORDS_PER_RUN: z.coerce.number().int().positive().default(4),
  SCRAPE_PRODUCTS_PER_KEYWORD: z.coerce.number().int().positive().default(15),
  CRON_SCRAPE_PRODUCTS: z.string().default("0 8,13,19,22 * * *"),

  // Budget caps
  // Per-channel daily post caps (V2 vision safeguard against bot-detection)
  DAILY_POSTS_FACEBOOK: z.coerce.number().int().positive().default(5).optional(),
  DAILY_POSTS_INSTAGRAM: z.coerce.number().int().positive().default(5).optional(),
  DAILY_POSTS_TIKTOK: z.coerce.number().int().positive().default(3).optional(),

  DAILY_LLM_BUDGET_USD: z.coerce.number().nonnegative().default(10),
  DAILY_VIDEO_GEN_BUDGET_USD: z.coerce.number().nonnegative().default(10),
  DAILY_IMAGE_GEN_BUDGET_USD: z.coerce.number().nonnegative().default(3),
  DAILY_VOICE_GEN_BUDGET_USD: z.coerce.number().nonnegative().default(2),

  // Feature flags
  FEATURE_TIKTOK_AUTO_POST: boolish,
  FEATURE_META_AUTO_POST: boolish,
  FEATURE_AI_BRAIN: boolish,
  FEATURE_PROMO_HUNTER: boolish,
  FEATURE_AUTO_TRANSLATE: boolish,

  // Debug
  DEBUG_DRY_RUN: boolish,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment configuration:");
    console.error(parsed.error.format());
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}

export const env = getEnv();

/** Capability checks — what features are configured and enabled. */
export const can = {
  scrapeShopee: () => Boolean(env.APIFY_TOKEN),
  generateContent: () => Boolean(env.ANTHROPIC_API_KEY),
  generateVoice: () => Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID),
  generateImages: () => Boolean(env.REPLICATE_API_TOKEN || env.FLUX_API_KEY),
  generateVideo: () => Boolean(env.KLING_API_KEY || env.SORA_API_KEY || env.RUNWAY_API_KEY),
  postMeta: () => Boolean(env.META_PAGE_ACCESS_TOKEN) && env.FEATURE_META_AUTO_POST,
  postTikTok: () => Boolean(env.TIKTOK_ACCESS_TOKEN) && env.FEATURE_TIKTOK_AUTO_POST,
  deployCloudflare: () => Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID),
  uploadR2: () => Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY),
  alertEmail: () => Boolean(env.RESEND_API_KEY && env.OPERATOR_EMAIL),
  isDryRun: () => env.DEBUG_DRY_RUN,
} as const;

/** One-line capability summary at startup. */
export function summarizeCapabilities(): string {
  const rows: [string, boolean][] = [
    ["DB", Boolean(env.DATABASE_URL && !env.DATABASE_URL.includes("PASS"))],
    ["Claude", can.generateContent()],
    ["Apify.shopee", can.scrapeShopee()],
    ["Voice", can.generateVoice()],
    ["Images", can.generateImages()],
    ["Video", can.generateVideo()],
    ["Meta.post", can.postMeta()],
    ["TikTok.post", can.postTikTok()],
    ["CF.deploy", can.deployCloudflare()],
    ["R2", can.uploadR2()],
    ["Email.alert", can.alertEmail()],
    ["DryRun", can.isDryRun()],
  ];
  return rows.map(([k, v]) => `${v ? "✓" : "·"} ${k}`).join("  ");
}
