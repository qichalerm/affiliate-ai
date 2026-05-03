import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ===================================================================
 * ENUMS
 * =================================================================== */

export const platformEnum = pgEnum("platform", [
  "shopee",
  "lazada",
  "tiktok_shop",
  "jd_central",
  "robinson",
]);

export const contentTypeEnum = pgEnum("content_type", [
  "review",
  "comparison",
  "best_of",
  "deal",
  "story",
  "guide",
  "price_compare",
]);

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "pending_review",
  "published",
  "archived",
  "rejected",
]);

export const channelEnum = pgEnum("channel", [
  "web",
  "tiktok",
  "facebook",
  "instagram",
  "youtube",
  "pinterest",
  "twitter",
  "telegram",
  "email",
  "lemon8",
  "threads",
]);

export const trendVelocityEnum = pgEnum("trend_velocity", [
  "emerging",
  "rising",
  "peak",
  "stable",
  "declining",
]);

export const alertSeverityEnum = pgEnum("alert_severity", ["info", "warn", "error", "critical"]);
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "success",
  "failed",
  "skipped",
]);

/* ===================================================================
 * REFERENCE: CATEGORIES
 * =================================================================== */

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 128 }).notNull().unique(),
    nameTh: varchar("name_th", { length: 256 }).notNull(),
    nameEn: varchar("name_en", { length: 256 }),
    parentId: integer("parent_id"),
    shopeeCategoryId: bigint("shopee_category_id", { mode: "number" }),
    depth: integer("depth").notNull().default(0),
    sortOrder: integer("sort_order").default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    parentIdx: index("categories_parent_idx").on(t.parentId),
    shopeeCatIdx: index("categories_shopee_cat_idx").on(t.shopeeCategoryId),
  }),
);

/* ===================================================================
 * SHOPS (merchants)
 * =================================================================== */

export const shops = pgTable(
  "shops",
  {
    id: serial("id").primaryKey(),
    platform: platformEnum("platform").notNull(),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 512 }).notNull(),
    slug: varchar("slug", { length: 256 }),
    isMall: boolean("is_mall").notNull().default(false),
    isPreferred: boolean("is_preferred").notNull().default(false),
    rating: real("rating"),
    ratingCount: integer("rating_count").default(0),
    followerCount: integer("follower_count").default(0),
    productCount: integer("product_count").default(0),
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
    nameIdx: index("shops_name_idx").on(t.name),
    reliabilityIdx: index("shops_reliability_idx").on(t.reliabilityScore),
  }),
);

/* ===================================================================
 * PRODUCTS (core)
 * =================================================================== */

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    platform: platformEnum("platform").notNull(),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    shopId: integer("shop_id").references(() => shops.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),

    // Identity
    name: text("name").notNull(),
    slug: varchar("slug", { length: 384 }).notNull().unique(),
    brand: varchar("brand", { length: 128 }),
    model: varchar("model", { length: 256 }),

    // Description
    descriptionRaw: text("description_raw"),
    specifications: jsonb("specifications"),

    // Images
    primaryImage: text("primary_image"),
    imageUrls: jsonb("image_urls").$type<string[]>().default([]),

    // Variants
    hasVariants: boolean("has_variants").notNull().default(false),
    variants: jsonb("variants"),

    // Snapshots (for fast queries — full history in product_prices)
    currentPrice: integer("current_price"), // satang (1 baht = 100 satang)
    originalPrice: integer("original_price"),
    discountPercent: real("discount_percent"),
    stock: integer("stock"),

    // Performance
    rating: real("rating"),
    ratingCount: integer("rating_count").default(0),
    soldCount: integer("sold_count").default(0),
    soldCount30d: integer("sold_count_30d"),
    viewCount: integer("view_count"),
    likeCount: integer("like_count"),

    // Affiliate
    baseCommissionRate: real("base_commission_rate"), // 0..1
    xtraCommissionRate: real("xtra_commission_rate"),
    effectiveCommissionRate: real("effective_commission_rate"),
    hasFreeShipping: boolean("has_free_shipping").default(false),
    hasVoucher: boolean("has_voucher").default(false),

    // Scoring (computed by Layer 8)
    demandScore: real("demand_score"),
    profitabilityScore: real("profitability_score"),
    seasonalityBoost: real("seasonality_boost"),
    finalScore: real("final_score"),

    // Risk flags (Layer 11)
    flagTrademark: boolean("flag_trademark").notNull().default(false),
    flagRegulated: boolean("flag_regulated").notNull().default(false), // ยา, อาหารเสริม
    flagBlacklisted: boolean("flag_blacklisted").notNull().default(false),
    flagReason: text("flag_reason"),

    // Tracking
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }).defaultNow().notNull(),
    lastScoredAt: timestamp("last_scored_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),

    // Pre-generated Shopee affiliate short link (shp.ee/xxxxx).
    // When set, all outputs (web, telegram, social) use this link instead of
    // building a URL — gives proper attribution in Shopee's affiliate dashboard.
    shopeeShortUrl: varchar("shopee_short_url", { length: 255 }),
  },
  (t) => ({
    platformExtIdx: uniqueIndex("products_platform_ext_idx").on(t.platform, t.externalId),
    slugIdx: uniqueIndex("products_slug_idx").on(t.slug),
    categoryIdx: index("products_category_idx").on(t.categoryId),
    shopIdx: index("products_shop_idx").on(t.shopId),
    finalScoreIdx: index("products_final_score_idx").on(t.finalScore),
    soldCountIdx: index("products_sold_count_idx").on(t.soldCount),
    ratingIdx: index("products_rating_idx").on(t.rating),
    activeFlagIdx: index("products_active_idx").on(t.isActive, t.flagBlacklisted),
  }),
);

/* ===================================================================
 * PRODUCT PRICES (history — for charts)
 * =================================================================== */

export const productPrices = pgTable(
  "product_prices",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    price: integer("price").notNull(), // satang
    originalPrice: integer("original_price"),
    stock: integer("stock"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    productTimeIdx: index("product_prices_product_time_idx").on(t.productId, t.capturedAt),
  }),
);

/* ===================================================================
 * PRODUCT REVIEWS (scraped from Shopee)
 * =================================================================== */

export const productReviews = pgTable(
  "product_reviews",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    externalId: varchar("external_id", { length: 64 }),
    rating: integer("rating"), // 1-5
    body: text("body").notNull(),
    bodyLanguage: varchar("body_language", { length: 8 }).default("th"),
    reviewerNameMasked: varchar("reviewer_name_masked", { length: 128 }),
    isVerified: boolean("is_verified").default(false),
    sentiment: real("sentiment"), // -1..1 from LLM
    helpfulCount: integer("helpful_count").default(0),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    productIdx: index("product_reviews_product_idx").on(t.productId),
    productExtIdx: uniqueIndex("product_reviews_ext_idx").on(t.productId, t.externalId),
  }),
);

/* ===================================================================
 * PRICE COMPARISON (cross-platform)
 * =================================================================== */

export const priceCompare = pgTable(
  "price_compare",
  {
    id: serial("id").primaryKey(),
    primaryProductId: integer("primary_product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    matchedProductId: integer("matched_product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    matchConfidence: real("match_confidence").notNull(), // 0..1
    matchMethod: varchar("match_method", { length: 32 }), // name | image_hash | barcode
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    primaryIdx: index("price_compare_primary_idx").on(t.primaryProductId),
    pairIdx: uniqueIndex("price_compare_pair_idx").on(t.primaryProductId, t.matchedProductId),
  }),
);

/* ===================================================================
 * AFFILIATE LINKS (with sub-IDs for attribution)
 * =================================================================== */

export const affiliateLinks = pgTable(
  "affiliate_links",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    contentPageId: integer("content_page_id"),
    publishedPostId: integer("published_post_id"),
    channel: channelEnum("channel").notNull(),
    fullUrl: text("full_url").notNull(),
    shortUrl: text("short_url"),
    subId: varchar("sub_id", { length: 128 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    productIdx: index("affiliate_links_product_idx").on(t.productId),
    channelIdx: index("affiliate_links_channel_idx").on(t.channel),
  }),
);

/* ===================================================================
 * CONTENT PAGES (web pages we publish)
 * =================================================================== */

export const contentPages = pgTable(
  "content_pages",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 384 }).notNull().unique(),
    type: contentTypeEnum("type").notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    metaDescription: varchar("meta_description", { length: 320 }),
    h1: varchar("h1", { length: 512 }),

    // Targets
    primaryProductId: integer("primary_product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    relatedProductIds: jsonb("related_product_ids").$type<number[]>().default([]),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),

    // Content
    contentMarkdown: text("content_markdown"),
    contentJson: jsonb("content_json"), // structured: hero, verdict, specs, faq, ...
    keywords: jsonb("keywords").$type<string[]>().default([]),

    // SEO
    canonicalUrl: text("canonical_url"),
    schemaJsonLd: jsonb("schema_json_ld"),
    ogImage: text("og_image"),

    // Status
    status: contentStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastBuildAt: timestamp("last_build_at", { withTimezone: true }),

    // Performance (denormalized cache, real source = analytics)
    impressions30d: integer("impressions_30d").default(0),
    clicks30d: integer("clicks_30d").default(0),
    conversions30d: integer("conversions_30d").default(0),
    revenue30dSatang: bigint("revenue_30d_satang", { mode: "number" }).default(0),

    // Compliance
    aiContentPercent: real("ai_content_percent"), // 0..1
    complianceCheckedAt: timestamp("compliance_checked_at", { withTimezone: true }),
    complianceFlags: jsonb("compliance_flags"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("content_pages_slug_idx").on(t.slug),
    typeIdx: index("content_pages_type_idx").on(t.type),
    primaryProdIdx: index("content_pages_primary_prod_idx").on(t.primaryProductId),
    statusIdx: index("content_pages_status_idx").on(t.status),
    revenueIdx: index("content_pages_revenue_idx").on(t.revenue30dSatang),
  }),
);

/* ===================================================================
 * CONTENT ASSETS (images/videos/audio generated)
 * =================================================================== */

export const contentAssets = pgTable(
  "content_assets",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull(), // image | video | audio | thumbnail
    url: text("url").notNull(),
    storageProvider: varchar("storage_provider", { length: 32 }).default("r2"),
    storageKey: text("storage_key"),
    width: integer("width"),
    height: integer("height"),
    durationSec: real("duration_sec"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    mimeType: varchar("mime_type", { length: 64 }),

    // Provenance (for compliance)
    generatedBy: varchar("generated_by", { length: 64 }), // claude | flux | sora | elevenlabs | scraped
    sourceUrl: text("source_url"),
    isAiGenerated: boolean("is_ai_generated").notNull().default(false),
    c2paMetadata: jsonb("c2pa_metadata"),

    contentPageId: integer("content_page_id").references(() => contentPages.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    contentPageIdx: index("content_assets_content_page_idx").on(t.contentPageId),
    kindIdx: index("content_assets_kind_idx").on(t.kind),
  }),
);

/* ===================================================================
 * PUBLISHED POSTS (track what's been posted to which channel)
 * =================================================================== */

export const publishedPosts = pgTable(
  "published_posts",
  {
    id: serial("id").primaryKey(),
    channel: channelEnum("channel").notNull(),
    accountIdentifier: varchar("account_identifier", { length: 128 }).notNull(), // FB page id, TT user id
    externalPostId: varchar("external_post_id", { length: 256 }),
    postUrl: text("post_url"),

    contentPageId: integer("content_page_id").references(() => contentPages.id, {
      onDelete: "set null",
    }),
    contentJson: jsonb("content_json"), // caption, hashtags, asset refs

    // Status
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    status: jobStatusEnum("status").notNull().default("queued"),
    errorMessage: text("error_message"),

    // AI label compliance
    aiLabelApplied: boolean("ai_label_applied").notNull().default(false),
    affiliateDisclosureApplied: boolean("affiliate_disclosure_applied").notNull().default(false),

    // Performance (cached, real source = analytics layer)
    reach: integer("reach"),
    impressions: integer("impressions"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    clicks: integer("clicks"),
    avgWatchTimeSec: real("avg_watch_time_sec"),
    contentScore: real("content_score"), // 0..100 percentile

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    metricsUpdatedAt: timestamp("metrics_updated_at", { withTimezone: true }),
  },
  (t) => ({
    channelIdx: index("published_posts_channel_idx").on(t.channel, t.publishedAt),
    statusIdx: index("published_posts_status_idx").on(t.status),
    contentPageIdx: index("published_posts_content_page_idx").on(t.contentPageId),
    scoreIdx: index("published_posts_score_idx").on(t.contentScore),
  }),
);

/* ===================================================================
 * TRENDS (Layer 8: Product Intelligence)
 * =================================================================== */

export const trends = pgTable(
  "trends",
  {
    id: serial("id").primaryKey(),
    keyword: varchar("keyword", { length: 256 }).notNull(),
    source: varchar("source", { length: 32 }).notNull(), // tiktok | google | shopee | pantip | twitter
    velocity: trendVelocityEnum("velocity").notNull(),
    growthPercent: real("growth_percent"),
    volumeEstimate: integer("volume_estimate"),
    relatedProductIds: jsonb("related_product_ids").$type<number[]>().default([]),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    keywordIdx: index("trends_keyword_idx").on(t.keyword),
    sourceIdx: index("trends_source_idx").on(t.source, t.capturedAt),
    velocityIdx: index("trends_velocity_idx").on(t.velocity),
  }),
);

/* ===================================================================
 * CAMPAIGNS (Shopee promotional campaigns)
 * =================================================================== */

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    platform: platformEnum("platform").notNull().default("shopee"),
    externalId: varchar("external_id", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(), // mission | category_boost | seasonal | flash_xtra
    bonusRate: real("bonus_rate"),
    maxPayout: integer("max_payout_satang"),
    eligibleCategoryIds: jsonb("eligible_category_ids").$type<number[]>().default([]),
    requirements: jsonb("requirements"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    enrollmentRequired: boolean("enrollment_required").notNull().default(false),
    isAutoEnrolled: boolean("is_auto_enrolled").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    progressJson: jsonb("progress_json"),
    rewardClaimedAt: timestamp("reward_claimed_at", { withTimezone: true }),
    rewardAmountSatang: integer("reward_amount_satang"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    platformExtIdx: uniqueIndex("campaigns_platform_ext_idx").on(t.platform, t.externalId),
    activeIdx: index("campaigns_active_idx").on(t.startsAt, t.endsAt),
  }),
);

/* ===================================================================
 * CONVERSIONS (from Shopee Affiliate API)
 * =================================================================== */

export const conversions = pgTable(
  "conversions",
  {
    id: serial("id").primaryKey(),
    affiliateLinkId: integer("affiliate_link_id").references(() => affiliateLinks.id),
    externalOrderId: varchar("external_order_id", { length: 64 }),
    productId: integer("product_id").references(() => products.id),
    isIndirect: boolean("is_indirect").notNull().default(false),
    quantitySold: integer("quantity_sold").default(1),
    grossSatang: bigint("gross_satang", { mode: "number" }),
    commissionSatang: bigint("commission_satang", { mode: "number" }),
    commissionRate: real("commission_rate"),
    isRefunded: boolean("is_refunded").notNull().default(false),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    paidOutAt: timestamp("paid_out_at", { withTimezone: true }),
    orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orderIdx: uniqueIndex("conversions_order_idx").on(t.externalOrderId),
    linkIdx: index("conversions_link_idx").on(t.affiliateLinkId),
    productIdx: index("conversions_product_idx").on(t.productId),
    timeIdx: index("conversions_time_idx").on(t.orderedAt),
  }),
);

/* ===================================================================
 * CLICKS (from short link redirects)
 * =================================================================== */

export const clicks = pgTable(
  "clicks",
  {
    id: serial("id").primaryKey(),
    affiliateLinkId: integer("affiliate_link_id")
      .references(() => affiliateLinks.id, { onDelete: "cascade" })
      .notNull(),
    ipHash: varchar("ip_hash", { length: 64 }),
    countryCode: varchar("country_code", { length: 4 }),
    userAgentHash: varchar("user_agent_hash", { length: 64 }),
    referrer: text("referrer"),
    isUnique: boolean("is_unique").notNull().default(true),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    linkTimeIdx: index("clicks_link_time_idx").on(t.affiliateLinkId, t.occurredAt),
  }),
);

/* ===================================================================
 * SCRAPER RUNS (job log)
 * =================================================================== */

export const scraperRuns = pgTable(
  "scraper_runs",
  {
    id: serial("id").primaryKey(),
    scraper: varchar("scraper", { length: 64 }).notNull(),
    target: varchar("target", { length: 256 }), // category id, search term, product id
    status: jobStatusEnum("status").notNull().default("queued"),
    itemsAttempted: integer("items_attempted").default(0),
    itemsSucceeded: integer("items_succeeded").default(0),
    itemsFailed: integer("items_failed").default(0),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    proxyUsed: varchar("proxy_used", { length: 128 }),
    /** Cost in micro-USD ($1 = 1,000,000). Tracks per-run spend on managed scrapers (Apify, Scrapfly). */
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).default(0),
    raw: jsonb("raw"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    scraperTimeIdx: index("scraper_runs_scraper_time_idx").on(t.scraper, t.startedAt),
    statusIdx: index("scraper_runs_status_idx").on(t.status),
    startedAtIdx: index("scraper_runs_started_at_idx").on(t.startedAt),
  }),
);

/* ===================================================================
 * GENERATION RUNS (LLM job log)
 * =================================================================== */

export const generationRuns = pgTable(
  "generation_runs",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull(), // verdict | comparison | story | meta
    contentPageId: integer("content_page_id").references(() => contentPages.id, {
      onDelete: "set null",
    }),
    model: varchar("model", { length: 64 }),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: real("cost_usd"),
    durationMs: integer("duration_ms"),
    status: jobStatusEnum("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    raw: jsonb("raw"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    kindTimeIdx: index("generation_runs_kind_time_idx").on(t.kind, t.startedAt),
    contentPageIdx: index("generation_runs_content_page_idx").on(t.contentPageId),
  }),
);

/* ===================================================================
 * ALERTS / EVENTS
 * =================================================================== */

export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    severity: alertSeverityEnum("severity").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    body: text("body"),
    metadata: jsonb("metadata"),
    requiresUserAction: boolean("requires_user_action").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    severityIdx: index("alerts_severity_idx").on(t.severity, t.createdAt),
    unresolvedIdx: index("alerts_unresolved_idx").on(t.resolvedAt),
  }),
);

/* ===================================================================
 * COMPLIANCE LOGS
 * =================================================================== */

export const complianceLogs = pgTable(
  "compliance_logs",
  {
    id: serial("id").primaryKey(),
    subjectKind: varchar("subject_kind", { length: 32 }).notNull(), // content_page | published_post | product
    subjectId: integer("subject_id").notNull(),
    checkName: varchar("check_name", { length: 64 }).notNull(),
    passed: boolean("passed").notNull(),
    severity: alertSeverityEnum("severity").default("info"),
    notes: text("notes"),
    autoFixApplied: boolean("auto_fix_applied").notNull().default(false),
    autoFixDescription: text("auto_fix_description"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    subjectIdx: index("compliance_logs_subject_idx").on(t.subjectKind, t.subjectId),
    failedIdx: index("compliance_logs_failed_idx").on(t.passed, t.severity),
  }),
);

/* ===================================================================
 * POLICY CHANGES (Layer 11 — track TOS updates)
 * =================================================================== */

export const policyChanges = pgTable(
  "policy_changes",
  {
    id: serial("id").primaryKey(),
    platform: varchar("platform", { length: 32 }).notNull(),
    sourceUrl: text("source_url").notNull(),
    title: varchar("title", { length: 512 }),
    summary: text("summary"),
    diff: text("diff"),
    severity: alertSeverityEnum("severity").default("info"),
    effectiveDate: timestamp("effective_date", { withTimezone: true }),
    adaptedAt: timestamp("adapted_at", { withTimezone: true }),
    requiresHumanReview: boolean("requires_human_review").notNull().default(true),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    platformIdx: index("policy_changes_platform_idx").on(t.platform, t.detectedAt),
    severityIdx: index("policy_changes_severity_idx").on(t.severity),
  }),
);

/* ===================================================================
 * PRODUCT SCORE HISTORY (Layer 8 — track scoring over time)
 * =================================================================== */

export const productScoreHistory = pgTable(
  "product_score_history",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    demandScore: real("demand_score"),
    profitabilityScore: real("profitability_score"),
    seasonalityBoost: real("seasonality_boost"),
    finalScore: real("final_score"),
    estimatedNetPerVisit: real("estimated_net_per_visit"),
    estimatedCvr: real("estimated_cvr"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    productTimeIdx: index("score_history_product_time_idx").on(t.productId, t.capturedAt),
  }),
);

/* ===================================================================
 * SCRAPE ACCOUNT POOL (Layer 1 hardening — multi-account orchestration)
 * Phase 2: scrape Shopee dashboard from rotating accounts
 * =================================================================== */

export const scrapeAccounts = pgTable(
  "scrape_accounts",
  {
    id: serial("id").primaryKey(),
    label: varchar("label", { length: 64 }).notNull(),
    platform: platformEnum("platform").notNull(),
    sessionCookie: text("session_cookie"),
    sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }),
    fingerprintJson: jsonb("fingerprint_json"), // UA + proxy preference
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    activeIdx: index("scrape_accounts_active_idx").on(t.isActive, t.cooldownUntil),
  }),
);

/* ===================================================================
 * EMAIL SUBSCRIBERS + SENDS (Phase 2 wave 8 — newsletter)
 * =================================================================== */

export const emailSubscribers = pgTable(
  "email_subscribers",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    niche: varchar("niche", { length: 32 }),
    source: varchar("source", { length: 64 }),
    consentedAt: timestamp("consented_at", { withTimezone: true }).defaultNow(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmationToken: varchar("confirmation_token", { length: 64 }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    clickCount: integer("click_count").notNull().default(0),
  },
  (t) => ({
    activeIdx: index("email_subscribers_active_idx").on(t.unsubscribedAt),
  }),
);

export const emailSends = pgTable(
  "email_sends",
  {
    id: serial("id").primaryKey(),
    subscriberId: integer("subscriber_id")
      .references(() => emailSubscribers.id, { onDelete: "cascade" })
      .notNull(),
    campaign: varchar("campaign", { length: 128 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    resendId: varchar("resend_id", { length: 128 }),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
  },
  (t) => ({
    subscriberIdx: index("email_sends_subscriber_idx").on(t.subscriberId),
    campaignIdx: index("email_sends_campaign_idx").on(t.campaign, t.sentAt),
  }),
);

/* ===================================================================
 * KEYWORD PERFORMANCE (Layer 10 — Google Search Console daily ingestion)
 * =================================================================== */

export const keywordPerformance = pgTable(
  "keyword_performance",
  {
    id: serial("id").primaryKey(),
    contentPageId: integer("content_page_id").references(() => contentPages.id, {
      onDelete: "cascade",
    }),
    keyword: varchar("keyword", { length: 256 }).notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    avgPosition: real("avg_position"),
    ctr: real("ctr"), // clicks/impressions
    country: varchar("country", { length: 4 }),
    device: varchar("device", { length: 16 }), // desktop | mobile | tablet
    capturedDate: timestamp("captured_date", { mode: "date" }).notNull(), // day-level granularity
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pageDateIdx: index("keyword_perf_page_date_idx").on(t.contentPageId, t.capturedDate),
    keywordIdx: index("keyword_perf_keyword_idx").on(t.keyword),
    uniqueDayKey: uniqueIndex("keyword_perf_unique_idx").on(
      t.contentPageId,
      t.keyword,
      t.capturedDate,
      t.country,
      t.device,
    ),
  }),
);

/* ===================================================================
 * PAGE METRICS DAILY (Layer 10 — Cloudflare Analytics + aggregated rollup)
 * =================================================================== */

export const pageMetricsDaily = pgTable(
  "page_metrics_daily",
  {
    id: serial("id").primaryKey(),
    contentPageId: integer("content_page_id")
      .references(() => contentPages.id, { onDelete: "cascade" })
      .notNull(),
    capturedDate: timestamp("captured_date", { mode: "date" }).notNull(),

    // Traffic (from CF Analytics)
    visits: integer("visits").notNull().default(0),
    pageviews: integer("pageviews").notNull().default(0),
    uniqueVisitors: integer("unique_visitors").notNull().default(0),

    // From GSC
    impressions: integer("impressions").notNull().default(0),
    organicClicks: integer("organic_clicks").notNull().default(0),
    avgPosition: real("avg_position"),

    // Affiliate funnel (from clicks table)
    affiliateClicks: integer("affiliate_clicks").notNull().default(0),

    // Engagement (from CF Analytics)
    avgTimeOnPageSec: real("avg_time_on_page_sec"),
    bounceRate: real("bounce_rate"),

    // Computed score 0..100
    contentScore: real("content_score"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pageDateIdx: uniqueIndex("page_metrics_page_date_idx").on(t.contentPageId, t.capturedDate),
    dateIdx: index("page_metrics_date_idx").on(t.capturedDate),
    scoreIdx: index("page_metrics_score_idx").on(t.contentScore),
  }),
);

/* ===================================================================
 * RELATIONS
 * =================================================================== */

export const productsRelations = relations(products, ({ one, many }) => ({
  shop: one(shops, { fields: [products.shopId], references: [shops.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  prices: many(productPrices),
  reviews: many(productReviews),
}));

export const shopsRelations = relations(shops, ({ many }) => ({
  products: many(products),
}));

export const contentPagesRelations = relations(contentPages, ({ one, many }) => ({
  primaryProduct: one(products, {
    fields: [contentPages.primaryProductId],
    references: [products.id],
  }),
  category: one(categories, { fields: [contentPages.categoryId], references: [categories.id] }),
  assets: many(contentAssets),
  publishedPosts: many(publishedPosts),
}));

export const publishedPostsRelations = relations(publishedPosts, ({ one }) => ({
  contentPage: one(contentPages, {
    fields: [publishedPosts.contentPageId],
    references: [contentPages.id],
  }),
}));

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  product: one(products, { fields: [productPrices.productId], references: [products.id] }),
}));

export const productReviewsRelations = relations(productReviews, ({ one }) => ({
  product: one(products, { fields: [productReviews.productId], references: [products.id] }),
}));

/* ===================================================================
 * EXPORTS — types
 * =================================================================== */

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
export type ContentPage = typeof contentPages.$inferSelect;
export type NewContentPage = typeof contentPages.$inferInsert;
export type PublishedPost = typeof publishedPosts.$inferSelect;
export type ProductReview = typeof productReviews.$inferSelect;
export type Trend = typeof trends.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
