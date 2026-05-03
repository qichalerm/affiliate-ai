/**
 * Drizzle schema — V2 lean.
 *
 * Tables grow with sprints:
 *   Sprint 0 (this file):  shops, products, categories, scraper_runs, alerts, content_pages, prices
 *   Sprint 1 (M8):         affiliate_links, clicks
 *   Sprint 4-5 (M5):       published_posts, post_metrics
 *   Sprint 9 (M3):         experiments, experiment_results, variants
 *   Sprint 11 (M6):        promo_campaigns
 */

import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  integer,
  bigint,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ===================================================================
 * ENUMS
 * =================================================================== */

export const platformEnum = pgEnum("platform", ["shopee", "tiktok_shop"]);

export const channelEnum = pgEnum("channel", [
  "web",
  "facebook",
  "instagram",
  "tiktok",
  "shopee_video",
]);

export const contentTypeEnum = pgEnum("content_type", [
  "review",
  "comparison",
  "best_of",
  "deal",
  "story",
  "guide",
]);

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "pending_review",
  "published",
  "archived",
]);

export const scraperStatusEnum = pgEnum("scraper_status", [
  "running",
  "success",
  "partial",
  "failed",
  "skipped",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warn",
  "error",
  "critical",
]);

export const nicheEnum = pgEnum("niche", [
  "it_gadget",
  "beauty",
  "home_appliance",
  "sports_fitness",
  "mom_baby",
  "food_kitchen",
  "fashion",
  "car_garage",
]);

/* ===================================================================
 * CATEGORIES (depth ≤2 tree)
 * =================================================================== */

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id"),
    slug: varchar("slug", { length: 64 }).notNull(),
    nameTh: varchar("name_th", { length: 128 }).notNull(),
    nameEn: varchar("name_en", { length: 128 }),
    niche: nicheEnum("niche"),
    depth: integer("depth").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("categories_slug_idx").on(t.slug),
    parentIdx: index("categories_parent_idx").on(t.parentId),
    nicheIdx: index("categories_niche_idx").on(t.niche),
  }),
);

/* ===================================================================
 * SHOPS (sellers/brands across platforms)
 * =================================================================== */

export const shops = pgTable(
  "shops",
  {
    id: serial("id").primaryKey(),
    platform: platformEnum("platform").notNull(),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    isMall: boolean("is_mall").notNull().default(false),
    isPreferred: boolean("is_preferred").notNull().default(false),
    rating: real("rating"),
    ratingCount: integer("rating_count"),
    followerCount: integer("follower_count"),
    productCount: integer("product_count"),
    responseRate: real("response_rate"),
    responseTimeHours: real("response_time_hours"),
    shipFromLocation: varchar("ship_from_location", { length: 128 }),
    createdSinceDays: integer("created_since_days"),
    reliabilityScore: real("reliability_score"),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    platformExtIdx: uniqueIndex("shops_platform_ext_idx").on(t.platform, t.externalId),
    reliabilityIdx: index("shops_reliability_idx").on(t.reliabilityScore),
  }),
);

/* ===================================================================
 * PRODUCTS (lean — V2 starts narrow, expand as needed)
 * =================================================================== */

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    platform: platformEnum("platform").notNull(),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    shopId: integer("shop_id").references(() => shops.id, { onDelete: "set null" }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),

    // Identity
    name: text("name").notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    brand: varchar("brand", { length: 128 }),
    description: text("description"),

    // Media
    primaryImage: text("primary_image"),
    imageUrls: jsonb("image_urls").$type<string[]>(),

    // Price (in satang — integer, no float math)
    currentPrice: bigint("current_price", { mode: "number" }),
    originalPrice: bigint("original_price", { mode: "number" }),
    discountPercent: real("discount_percent"),

    // Demand signals
    rating: real("rating"),
    ratingCount: integer("rating_count"),
    soldCount: integer("sold_count"),
    soldCount30d: integer("sold_count_30d"),
    viewCount: integer("view_count"),
    likeCount: integer("like_count"),

    // Affiliate
    affiliateShortUrl: varchar("affiliate_short_url", { length: 255 }),  // shp.ee/xxx if available

    // Scoring (V2 — populated by Layer 2 Signal Analyzer)
    demandScore: real("demand_score"),
    profitabilityScore: real("profitability_score"),
    trendVelocity: real("trend_velocity"),       // -1..+1, recent acceleration
    finalScore: real("final_score"),
    competitionScore: real("competition_score"), // 0..1, lower = less competition

    // Flags
    isActive: boolean("is_active").notNull().default(true),
    flagBlacklisted: boolean("flag_blacklisted").notNull().default(false),
    flagRegulated: boolean("flag_regulated").notNull().default(false),
    flagReason: text("flag_reason"),

    // Tracking
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }).defaultNow().notNull(),
    lastScoredAt: timestamp("last_scored_at", { withTimezone: true }),
  },
  (t) => ({
    platformExtIdx: uniqueIndex("products_platform_ext_idx").on(t.platform, t.externalId),
    slugIdx: uniqueIndex("products_slug_idx").on(t.slug),
    categoryIdx: index("products_category_idx").on(t.categoryId),
    shopIdx: index("products_shop_idx").on(t.shopId),
    activeIdx: index("products_active_idx").on(t.isActive, t.flagBlacklisted),
    finalScoreIdx: index("products_final_score_idx").on(t.finalScore),
  }),
);

/* ===================================================================
 * PRODUCT PRICE HISTORY (price tracking over time)
 * =================================================================== */

export const productPrices = pgTable(
  "product_prices",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").references(() => products.id, { onDelete: "cascade" }).notNull(),
    price: bigint("price", { mode: "number" }).notNull(),
    originalPrice: bigint("original_price", { mode: "number" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    productCapturedIdx: index("product_prices_product_captured_idx").on(t.productId, t.capturedAt),
  }),
);

/* ===================================================================
 * SCRAPER RUNS (audit log + budget tracking)
 * =================================================================== */

export const scraperRuns = pgTable(
  "scraper_runs",
  {
    id: serial("id").primaryKey(),
    scraper: varchar("scraper", { length: 32 }).notNull(),  // shopee_apify | tiktok_shop | ...
    target: varchar("target", { length: 255 }).notNull(),    // keyword or category being scraped
    status: scraperStatusEnum("status").notNull(),
    itemsAttempted: integer("items_attempted").default(0),
    itemsSucceeded: integer("items_succeeded").default(0),
    itemsFailed: integer("items_failed").default(0),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).default(0), // $ × 1e6
    durationMs: integer("duration_ms"),
    errorMsg: text("error_msg"),
    raw: jsonb("raw"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    scraperStartedIdx: index("scraper_runs_scraper_started_idx").on(t.scraper, t.startedAt),
    statusIdx: index("scraper_runs_status_idx").on(t.status),
  }),
);

/* ===================================================================
 * CONTENT PAGES (review/comparison/best-of articles + multilingual)
 * =================================================================== */

export const contentPages = pgTable(
  "content_pages",
  {
    id: serial("id").primaryKey(),
    type: contentTypeEnum("type").notNull(),
    status: contentStatusEnum("status").notNull().default("draft"),
    slug: varchar("slug", { length: 255 }).notNull(),
    primaryProductId: integer("primary_product_id").references(() => products.id, { onDelete: "set null" }),
    relatedProductIds: jsonb("related_product_ids").$type<number[]>(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),

    // Content (TH = source)
    title: varchar("title", { length: 255 }).notNull(),
    h1: varchar("h1", { length: 255 }),
    metaDescription: text("meta_description"),
    keywords: jsonb("keywords").$type<string[]>(),
    contentJson: jsonb("content_json").notNull(), // verdict, pros/cons, faqs, etc.
    ogImage: text("og_image"),

    // Multilingual translations (V2 — Sprint 12)
    // Shape: { en: { title, h1, metaDesc, contentJson }, zh: {...}, ja: {...} }
    translations: jsonb("translations"),

    // Generation provenance
    aiContentPercent: integer("ai_content_percent").default(100),
    llmModel: varchar("llm_model", { length: 64 }),
    llmCostUsd: real("llm_cost_usd").default(0),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("content_pages_slug_idx").on(t.slug),
    typeStatusIdx: index("content_pages_type_status_idx").on(t.type, t.status),
    primaryProductIdx: index("content_pages_primary_product_idx").on(t.primaryProductId),
  }),
);

/* ===================================================================
 * GENERATION RUNS (Sprint 4 — M4)
 * Audit log + cost tracking for every LLM/voice/image/video gen call.
 * Used by M9 (Learning Optimizer) for budget allocation per task type.
 * =================================================================== */

export const generationRuns = pgTable(
  "generation_runs",
  {
    id: serial("id").primaryKey(),
    task: varchar("task", { length: 64 }).notNull(),  // e.g. "variant_caption.facebook"
    provider: varchar("provider", { length: 32 }).notNull(),  // anthropic | replicate | elevenlabs | ffmpeg
    model: varchar("model", { length: 64 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).notNull().default(0),
    durationMs: integer("duration_ms"),
    success: boolean("success").notNull().default(true),
    errorMsg: text("error_msg"),
    metadata: jsonb("metadata"),  // e.g. { productId, channel, variant }
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    taskCreatedIdx: index("generation_runs_task_created_idx").on(t.task, t.createdAt),
    providerCreatedIdx: index("generation_runs_provider_created_idx").on(t.provider, t.createdAt),
  }),
);

/* ===================================================================
 * CONTENT VARIANTS (Sprint 4 — M4)
 * 3+ variants per (product × channel) for A/B/C testing. One row per
 * generated caption/script/etc. M3 (Brain) picks which one to publish
 * via bandit weights; M9 (Learning) updates weights based on outcomes.
 * =================================================================== */

export const variantAngleEnum = pgEnum("variant_angle", [
  "deal",          // urgency, discount-focused
  "story",         // narrative, "I tried this for 30 days"
  "educational",   // how-to, comparison, buying guide
  "listicle",      // top 5/10 format
  "trend",         // tied to current viral topic
  "brand",         // brand-spotlight
  "faq",           // Q&A format
]);

export const contentVariants = pgTable(
  "content_variants",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").references(() => products.id, { onDelete: "cascade" }).notNull(),
    channel: channelEnum("channel").notNull(),
    angle: variantAngleEnum("angle").notNull(),
    variantCode: varchar("variant_code", { length: 8 }).notNull(),  // "A", "B", "C", etc.

    // Generated content
    caption: text("caption").notNull(),
    hashtags: jsonb("hashtags").$type<string[]>(),
    hook: text("hook"),  // first line / opener (for analysis)

    // Generation provenance
    generationRunId: integer("generation_run_id").references(() => generationRuns.id),
    llmModel: varchar("llm_model", { length: 64 }),

    // Quality gate result
    gateApproved: boolean("gate_approved").notNull().default(false),
    gateIssues: jsonb("gate_issues").$type<string[]>(),

    // Performance (populated by M7 + M9)
    timesShown: integer("times_shown").notNull().default(0),
    timesClicked: integer("times_clicked").notNull().default(0),
    timesConverted: integer("times_converted").notNull().default(0),
    revenueSatang: bigint("revenue_satang", { mode: "number" }).notNull().default(0),

    // Bandit weight (updated nightly by M9)
    banditWeight: real("bandit_weight").notNull().default(1.0),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    productChannelIdx: index("content_variants_product_channel_idx").on(t.productId, t.channel),
    activeIdx: index("content_variants_active_idx").on(t.isActive, t.gateApproved),
    banditIdx: index("content_variants_bandit_idx").on(t.banditWeight),
  }),
);

/* ===================================================================
 * AFFILIATE LINKS (Sprint 1 — M8)
 * Every trackable short URL we generate. One row per (product × channel × variant).
 * =================================================================== */

export const affiliateLinks = pgTable(
  "affiliate_links",
  {
    id: serial("id").primaryKey(),
    shortId: varchar("short_id", { length: 16 }).notNull(),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    channel: channelEnum("channel").notNull(),

    // Optional grouping for analytics
    campaign: varchar("campaign", { length: 64 }), // e.g. "morning_post_2026-05-03"
    variant: varchar("variant", { length: 8 }),    // A/B/C/... for multi-variant tests
    publishedPostId: integer("published_post_id"),  // FK added in Sprint 4

    // Destination
    fullUrl: text("full_url").notNull(),
    shopeeShortUrl: varchar("shopee_short_url", { length: 255 }), // shp.ee/xxx if available

    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    shortIdIdx: uniqueIndex("affiliate_links_short_id_idx").on(t.shortId),
    productChannelIdx: index("affiliate_links_product_channel_idx").on(t.productId, t.channel),
    campaignIdx: index("affiliate_links_campaign_idx").on(t.campaign),
  }),
);

/* ===================================================================
 * CLICKS (Sprint 1 — M8)
 * Every redirect request hitting /go/[shortId]. PII is hashed.
 * =================================================================== */

export const clicks = pgTable(
  "clicks",
  {
    id: serial("id").primaryKey(),
    affiliateLinkId: integer("affiliate_link_id")
      .references(() => affiliateLinks.id, { onDelete: "cascade" })
      .notNull(),
    shortId: varchar("short_id", { length: 16 }).notNull(),  // denormalized for analytics speed

    // PII — only hashed forms stored
    ipHash: varchar("ip_hash", { length: 64 }).notNull(),
    userAgentHash: varchar("user_agent_hash", { length: 64 }).notNull(),

    countryCode: varchar("country_code", { length: 2 }),
    referrer: text("referrer"),
    isBot: boolean("is_bot").notNull().default(false),
    isUnique: boolean("is_unique").notNull().default(true), // first click per (ipHash, linkId, day)

    clickedAt: timestamp("clicked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    linkClickedIdx: index("clicks_link_clicked_idx").on(t.affiliateLinkId, t.clickedAt),
    shortIdClickedIdx: index("clicks_short_id_clicked_idx").on(t.shortId, t.clickedAt),
    countryIdx: index("clicks_country_idx").on(t.countryCode),
  }),
);

/* ===================================================================
 * ALERTS (operational issues that need attention)
 * =================================================================== */

export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    severity: alertSeverityEnum("severity").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    metadata: jsonb("metadata"),
    requiresUserAction: boolean("requires_user_action").notNull().default(false),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    severityIdx: index("alerts_severity_idx").on(t.severity, t.createdAt),
    unresolvedIdx: index("alerts_unresolved_idx").on(t.resolvedAt),
  }),
);
