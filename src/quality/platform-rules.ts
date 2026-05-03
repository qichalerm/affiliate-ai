/**
 * Per-platform formatting rules.
 *
 * Each platform has different limits + best-practice ranges.
 * Gate enforces hard limits (block if exceeded) and warns on best-practice misses.
 *
 * Sources (verified 2026-05):
 *   - FB Page caption: 63206 char hard, 40-80 char optimal for organic reach
 *   - IG Reel caption: 2200 char hard, 125-150 char optimal (truncated in feed)
 *   - IG hashtags: max 30 per post, 5-10 optimal
 *   - TikTok caption: 2200 char hard, 100-150 char optimal
 *   - TikTok hashtags: max 100 chars worth, 3-5 effective
 *   - Shopee Video desc: 150 char visible, hashtag 5 max
 */

export type Platform = "facebook" | "instagram" | "tiktok" | "shopee_video";

export interface PlatformRules {
  caption: {
    maxLength: number;
    optimalMin: number;
    optimalMax: number;
  };
  hashtags: {
    maxCount: number;
    optimalMin: number;
    optimalMax: number;
    /** Allow # in caption text (vs separate field). */
    inlineAllowed: boolean;
  };
  /** Cooldown between posts (anti-spam-detection). */
  minIntervalMin: number;
  /** Daily post cap to avoid platform throttling. */
  maxPostsPerDay: number;
  /** Required if affiliate (true for all our channels). */
  requiresAffiliateDisclosure: true;
}

export const PLATFORM_RULES: Record<Platform, PlatformRules> = {
  facebook: {
    caption: { maxLength: 63206, optimalMin: 40, optimalMax: 250 },
    hashtags: { maxCount: 30, optimalMin: 1, optimalMax: 5, inlineAllowed: true },
    minIntervalMin: 30,
    maxPostsPerDay: 25,
    requiresAffiliateDisclosure: true,
  },
  instagram: {
    caption: { maxLength: 2200, optimalMin: 70, optimalMax: 200 },
    hashtags: { maxCount: 30, optimalMin: 5, optimalMax: 10, inlineAllowed: true },
    minIntervalMin: 60,
    maxPostsPerDay: 25,
    requiresAffiliateDisclosure: true,
  },
  tiktok: {
    caption: { maxLength: 2200, optimalMin: 50, optimalMax: 150 },
    hashtags: { maxCount: 10, optimalMin: 3, optimalMax: 5, inlineAllowed: true },
    minIntervalMin: 90,  // strict
    maxPostsPerDay: 10,  // strict — TikTok 1-account
    requiresAffiliateDisclosure: true,
  },
  shopee_video: {
    caption: { maxLength: 150, optimalMin: 30, optimalMax: 130 },
    hashtags: { maxCount: 5, optimalMin: 1, optimalMax: 5, inlineAllowed: true },
    minIntervalMin: 60,
    maxPostsPerDay: 10,
    requiresAffiliateDisclosure: true,
  },
};

export interface PlatformCheckResult {
  passed: boolean;
  errors: string[];   // hard violations
  warnings: string[]; // best-practice misses (allowed but suboptimal)
  metrics: {
    captionLength: number;
    hashtagCount: number;
  };
}

function countHashtags(text: string): number {
  // Match #word or #ภาษาไทย
  const matches = text.match(/#[\p{L}\p{N}_]+/gu);
  return matches?.length ?? 0;
}

export function checkPlatformRules(text: string, platform: Platform): PlatformCheckResult {
  const rules = PLATFORM_RULES[platform];
  const errors: string[] = [];
  const warnings: string[] = [];

  const captionLength = text.length;
  const hashtagCount = countHashtags(text);

  // Hard limits
  if (captionLength > rules.caption.maxLength) {
    errors.push(
      `caption ${captionLength} exceeds ${platform} max ${rules.caption.maxLength}`,
    );
  }
  if (hashtagCount > rules.hashtags.maxCount) {
    errors.push(
      `${hashtagCount} hashtags exceeds ${platform} max ${rules.hashtags.maxCount}`,
    );
  }

  // Best-practice warnings
  if (captionLength < rules.caption.optimalMin) {
    warnings.push(
      `caption ${captionLength} below optimal ${rules.caption.optimalMin}-${rules.caption.optimalMax}`,
    );
  } else if (captionLength > rules.caption.optimalMax) {
    warnings.push(
      `caption ${captionLength} above optimal ${rules.caption.optimalMin}-${rules.caption.optimalMax}`,
    );
  }
  if (hashtagCount < rules.hashtags.optimalMin) {
    warnings.push(
      `${hashtagCount} hashtags below optimal ${rules.hashtags.optimalMin}-${rules.hashtags.optimalMax}`,
    );
  } else if (hashtagCount > rules.hashtags.optimalMax) {
    warnings.push(
      `${hashtagCount} hashtags above optimal ${rules.hashtags.optimalMin}-${rules.hashtags.optimalMax}`,
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    metrics: { captionLength, hashtagCount },
  };
}
