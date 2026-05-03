import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env" });

/**
 * Validated environment configuration.
 *
 * - Required vars throw at startup if missing.
 * - Optional vars allow the system to gracefully skip layers that are not yet configured.
 */

const boolish = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0"), z.literal("")])
  .transform((v) => v === "true" || v === "1")
  .default("false");

const optStr = z.string().min(1).optional().or(z.literal("").transform(() => undefined));

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TIMEZONE: z.string().default("Asia/Bangkok"),
  DOMAIN_NAME: z.string().default("yourdomain.com"),
  OPERATOR_EMAIL: optStr,

  // Database — required
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (Neon Postgres connection string)")
    .default("postgresql://placeholder:placeholder@localhost/placeholder"),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),

  // Anthropic — required for content generation
  ANTHROPIC_API_KEY: optStr,
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-4-5-20251001"),
  ANTHROPIC_MODEL_SMART: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_MODEL_PRO: z.string().default("claude-opus-4-7"),
  ANTHROPIC_PRO_THINKING_BUDGET: z.coerce.number().int().nonnegative().default(8000),

  // Affiliate
  SHOPEE_AFFILIATE_ID: optStr,
  SHOPEE_AFFILIATE_USERNAME: optStr,
  SHOPEE_AFFILIATE_PASSWORD: optStr,
  SHOPEE_API_KEY: optStr,
  SHOPEE_API_SECRET: optStr,
  SHOPEE_TRACKING_ID: optStr,

  // Cloudflare
  CLOUDFLARE_ACCOUNT_ID: optStr,
  CLOUDFLARE_API_TOKEN: optStr,
  CLOUDFLARE_ZONE_ID: optStr,
  CLOUDFLARE_PAGES_PROJECT: z.string().default("shopee-aggregator"),
  R2_ACCOUNT_ID: optStr,
  R2_ACCESS_KEY_ID: optStr,
  R2_SECRET_ACCESS_KEY: optStr,
  R2_BUCKET_NAME: z.string().default("affiliate-assets"),

  // GitHub
  GITHUB_TOKEN: optStr,
  GITHUB_REPO: optStr,

  // SEO
  GOOGLE_SERVICE_ACCOUNT_JSON_PATH: z.string().default("./secrets/google-service-account.json"),
  GOOGLE_SEARCH_CONSOLE_PROPERTY: optStr,
  BING_INDEXNOW_KEY: optStr,

  // AI generation
  ELEVENLABS_API_KEY: optStr,
  ELEVENLABS_VOICE_ID: optStr,
  FLUX_API_KEY: optStr,
  REPLICATE_API_TOKEN: optStr,
  SUBMAGIC_API_KEY: optStr,

  // Social
  TIKTOK_CLIENT_KEY: optStr,
  TIKTOK_CLIENT_SECRET: optStr,
  TIKTOK_ACCESS_TOKEN: optStr,
  META_APP_ID: optStr,
  META_APP_SECRET: optStr,
  META_PAGE_ID: optStr,
  META_PAGE_ACCESS_TOKEN: optStr,
  META_INSTAGRAM_BUSINESS_ID: optStr,
  YOUTUBE_API_KEY: optStr,
  YOUTUBE_CHANNEL_ID: optStr,
  PINTEREST_ACCESS_TOKEN: optStr,
  PINTEREST_BOARD_IDS: optStr,
  TWITTER_API_KEY: optStr,
  TWITTER_API_SECRET: optStr,
  TWITTER_ACCESS_TOKEN: optStr,
  TWITTER_ACCESS_SECRET: optStr,

  // Monitoring
  SENTRY_DSN: optStr,
  PLAUSIBLE_API_KEY: optStr,
  RESEND_API_KEY: optStr,
  EMAIL_FROM: optStr,

  // Trends / data
  FASTMOSS_API_KEY: optStr,
  KALODATA_API_KEY: optStr,
  SERPAPI_KEY: optStr,
  OPENMETEO_BASE_URL: z.string().default("https://api.open-meteo.com/v1"),
  NEWS_RSS_FEEDS: z.string().default(""),

  // Proxy
  WEBSHARE_API_KEY: optStr,
  PROXY_USERNAME: optStr,
  PROXY_PASSWORD: optStr,

  // IPRoyal residential proxy (for Lazada and other non-protected sites)
  IPROYAL_HOST: z.string().default("geo.iproyal.com"),
  IPROYAL_PORT: z.coerce.number().int().positive().default(12321),
  IPROYAL_LOGIN: optStr,
  IPROYAL_PASSWORD: optStr,

  // Apify (for Shopee — only working solution after testing)
  APIFY_TOKEN: optStr,
  APIFY_ACTOR_SHOPEE: z.string().default("xtracto/shopee-scraper"),
  APIFY_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(2.0),
  APIFY_MEMORY_MB: z.coerce.number().int().positive().default(1024),

  // Scrapfly (kept for non-Shopee fallback / future)
  SCRAPFLY_API_KEY: optStr,

  // Link mgmt
  BITLY_TOKEN: optStr,
  SHORTIO_API_KEY: optStr,
  SHORTIO_DOMAIN: optStr,

  // Auth
  CLERK_PUBLISHABLE_KEY: optStr,
  CLERK_SECRET_KEY: optStr,
  INTERNAL_API_SECRET: optStr,
  SESSION_SECRET: optStr,

  // DigitalOcean Spaces (optional, for backups)
  DO_SPACES_KEY: optStr,
  DO_SPACES_SECRET: optStr,
  DO_SPACES_REGION: z.string().default("sgp1"),
  DO_SPACES_BUCKET: optStr,

  // Cron overrides
  CRON_SCRAPE_PRODUCTS: optStr,
  CRON_GENERATE_PAGES: optStr,
  CRON_DEPLOY_SITE: optStr,
  CRON_SUBMIT_SITEMAP: optStr,
  CRON_DAILY_REPORT: optStr,
  CRON_HEALTH_CHECK: optStr,

  // Business settings
  PRIMARY_NICHE: z
    .enum(["it_gadget", "beauty", "home", "sports", "mom_baby"])
    .default("it_gadget"),
  SECONDARY_NICHE: optStr,
  /** Enable Lazada scraper + cross-platform jobs. Off by default — Apify Shopee-only is the supported MVP path. */
  FEATURE_LAZADA_ENABLED: boolish,
  /** Per-run scrape sizing — kept conservative to fit APIFY_DAILY_BUDGET_USD. */
  SCRAPE_KEYWORDS_PER_RUN: z.coerce.number().int().positive().default(3),
  SCRAPE_PRODUCTS_PER_KEYWORD: z.coerce.number().int().positive().default(20),
  POSTING_MODE: z.enum(["full_auto", "hybrid", "manual_review"]).default("hybrid"),
  HUMAN_FACE_INTRO_SECONDS: z.coerce.number().default(7),
  MAX_CHANNEL_CONCENTRATION: z.coerce.number().min(0).max(1).default(0.4),
  MIN_PRODUCT_RATING: z.coerce.number().min(0).max(5).default(4.0),
  MIN_PRODUCT_SOLD: z.coerce.number().int().nonnegative().default(50),
  EXCLUDE_NEW_SHOP_DAYS: z.coerce.number().int().nonnegative().default(180),
  DAILY_LLM_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  DAILY_VIDEO_GEN_BUDGET_USD: z.coerce.number().nonnegative().default(10),
  DAILY_PROXY_BUDGET_USD: z.coerce.number().nonnegative().default(2),
  TARGET_TIER: z.enum(["silver", "gold", "platinum"]).default("gold"),
  GMV_PUSH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),

  // Feature flags
  FEATURE_LAYER_1_DATA_COLLECTION: boolish,
  FEATURE_LAYER_2_CONTENT_GEN: boolish,
  FEATURE_LAYER_3_DISTRIBUTION: boolish,
  FEATURE_LAYER_4_OPTIMIZATION: boolish,
  FEATURE_LAYER_5_MONITORING: boolish,
  FEATURE_LAYER_6_SELF_HEALING: boolish,
  FEATURE_LAYER_7_CAMPAIGN_OPT: boolish,
  FEATURE_LAYER_8_PRODUCT_INTEL: boolish,
  FEATURE_LAYER_9_NARRATIVE: boolish,
  FEATURE_LAYER_10_PERFORMANCE_INTEL: boolish,
  FEATURE_LAYER_11_COMPLIANCE: boolish,
  FEATURE_LAZADA_SCRAPE: boolish,
  FEATURE_CROSS_PLATFORM_MATCH: boolish,
  FEATURE_SITEMAP_AUTO_SUBMIT: boolish,
  FEATURE_TIKTOK_AUTO_POST: boolish,
  FEATURE_META_AUTO_POST: boolish,
  FEATURE_PINTEREST_AUTO_POST: boolish,
  FEATURE_YOUTUBE_AUTO_POST: boolish,

  DEBUG_DRY_RUN: boolish,
  DEBUG_VERBOSE_LOGGING: boolish,
  DEBUG_SAVE_INTERMEDIATE: boolish,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Environment validation failed:");
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}

export const env = getEnv();

/* -------------------------------------------------------------------
 * Capability detection
 * Each predicate answers: "is this feature usable right now?"
 * ------------------------------------------------------------------- */
export const can = {
  generateContent: () => Boolean(env.ANTHROPIC_API_KEY),
  scrapeShopee: () => Boolean(env.APIFY_TOKEN), // requires Apify (Shopee anti-bot blocks DIY)
  scrapeShopeeViaApify: () => Boolean(env.APIFY_TOKEN),
  proxyResidential: () => Boolean(env.IPROYAL_LOGIN && env.IPROYAL_PASSWORD),
  trackShopeeDashboard: () =>
    Boolean(env.SHOPEE_AFFILIATE_USERNAME && env.SHOPEE_AFFILIATE_PASSWORD),
  postTikTok: () => Boolean(env.TIKTOK_ACCESS_TOKEN) && env.FEATURE_TIKTOK_AUTO_POST,
  postMeta: () => Boolean(env.META_PAGE_ACCESS_TOKEN) && env.FEATURE_META_AUTO_POST,
  postPinterest: () => Boolean(env.PINTEREST_ACCESS_TOKEN) && env.FEATURE_PINTEREST_AUTO_POST,
  postYouTube: () => Boolean(env.YOUTUBE_API_KEY) && env.FEATURE_YOUTUBE_AUTO_POST,
  generateVoice: () => Boolean(env.ELEVENLABS_API_KEY),
  generateImages: () => Boolean(env.FLUX_API_KEY || env.REPLICATE_API_TOKEN),
  deployCloudflare: () => Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID),
  uploadR2: () => Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY),
  shortenLinks: () => Boolean(env.SHORTIO_API_KEY || env.BITLY_TOKEN),
  fetchTikTokTrends: () => Boolean(env.FASTMOSS_API_KEY || env.KALODATA_API_KEY),
  isDryRun: () => env.DEBUG_DRY_RUN,
} as const;

/**
 * Print a one-line summary of which capabilities are available.
 * Useful at startup.
 */
export function summarizeCapabilities(): string {
  const rows: [string, boolean][] = [
    ["DB", Boolean(env.DATABASE_URL && !env.DATABASE_URL.includes("placeholder"))],
    ["Claude", can.generateContent()],
    ["Shopee.scrape", can.scrapeShopee()],
    ["Shopee.dashboard", can.trackShopeeDashboard()],
    ["Pinterest", can.postPinterest()],
    ["TikTok", can.postTikTok()],
    ["Meta", can.postMeta()],
    ["YouTube", can.postYouTube()],
    ["Voice", can.generateVoice()],
    ["Images", can.generateImages()],
    ["CF.deploy", can.deployCloudflare()],
    ["R2", can.uploadR2()],
    ["DryRun", can.isDryRun()],
  ];
  return rows.map(([k, v]) => `${v ? "✓" : "·"} ${k}`).join("  ");
}
