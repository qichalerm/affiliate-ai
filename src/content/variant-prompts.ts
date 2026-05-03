/**
 * Prompt templates per (channel × angle).
 *
 * Tuned per platform for length, tone, hashtag style.
 * The prompt asks Claude to return strict JSON so we parse reliably.
 */

import type { Platform } from "../quality/platform-rules.ts";
import { PLATFORM_RULES } from "../quality/platform-rules.ts";

export type Angle =
  | "deal"
  | "story"
  | "educational"
  | "listicle"
  | "trend"
  | "brand"
  | "faq";

export interface ProductInput {
  name: string;
  brand?: string | null;
  priceBaht: number;
  originalPriceBaht?: number | null;
  discountPercent?: number | null; // 0-1
  rating?: number | null;
  ratingCount?: number | null;
  category?: string;
  description?: string | null;
}

export interface PromptInput {
  product: ProductInput;
  channel: Platform;
  angle: Angle;
  shortUrl: string; // affiliate short URL to embed (or place at end)
  variantCode: string; // "A", "B", "C" — instructs Claude to make it different
}

const ANGLE_GUIDANCE: Record<Angle, string> = {
  deal: "Lead with urgency — the discount %, time-sensitive scarcity, before/after price. Action-oriented CTA.",
  story: "First-person narrative. 'I've been using X for N days, here's what changed.' Authentic, human tone, not salesy.",
  educational: "Teach the reader something. Buying guide angle. Compare specs, explain a feature, debunk a myth.",
  listicle: "Numbered format. 'Top 3 reasons this is worth it' or '5 things you didn't know'. Easy to scan.",
  trend: "Tie to a current viral topic, season, or news. 'With Songkran coming up...' or 'Now that everyone's talking about X...'",
  brand: "Brand-spotlight. Why this brand specifically. Heritage, trust signals, who else uses it.",
  faq: "Q&A format. Answer the 2-3 questions a buyer would ask before purchasing.",
};

const CHANNEL_TONE: Record<Platform, string> = {
  facebook: "Conversational, slightly long, can include emoji. Mix Thai + occasional English brand names.",
  instagram: "Visual-first — caption complements an image. Lifestyle aspirational tone. 5-10 hashtags grouped at end.",
  tiktok: "Short, punchy, hook in first 5 words. Casual Gen-Z Thai. 3-5 trending hashtags inline.",
  shopee_video: "Very short (under 130 chars). Direct product appeal. 1-3 hashtags max. Emoji ok.",
};

export function buildVariantPrompt(input: PromptInput): { system: string; user: string } {
  const rules = PLATFORM_RULES[input.channel];
  const product = input.product;

  const priceLine = product.originalPriceBaht && product.originalPriceBaht > product.priceBaht
    ? `${product.priceBaht.toLocaleString("th-TH")} บาท (ลดจาก ${product.originalPriceBaht.toLocaleString("th-TH")} บาท, ${Math.round((product.discountPercent ?? 0) * 100)}% off)`
    : `${product.priceBaht.toLocaleString("th-TH")} บาท`;

  const ratingLine = product.rating
    ? `${product.rating}/5 stars${product.ratingCount ? ` (${product.ratingCount.toLocaleString("th-TH")} reviews)` : ""}`
    : "no rating data";

  const system = `You write Thai-language affiliate marketing content for ${input.channel}.

Channel rules:
- Caption length: ${rules.caption.optimalMin}-${rules.caption.optimalMax} chars (hard max ${rules.caption.maxLength})
- Hashtags: ${rules.hashtags.optimalMin}-${rules.hashtags.optimalMax} (max ${rules.hashtags.maxCount})
- Tone: ${CHANNEL_TONE[input.channel]}

Angle: ${input.angle.toUpperCase()}
${ANGLE_GUIDANCE[input.angle]}

This is variant ${input.variantCode} — must feel distinct from other variants for the same product.
Use natural Thai language (not auto-translated stiffness). Mix in 1-2 English brand/tech words where natural.
Include the affiliate URL exactly once, near the end before the hashtags.
Always include #affiliate or equivalent disclosure (Thai PDPA requirement).

Reply with strict JSON only, no markdown, no preamble:
{
  "caption": "the full caption text including the URL and hashtags",
  "hook": "the first sentence/line — used for analysis",
  "hashtags": ["#tag1", "#tag2", ...]
}`;

  const user = `Generate variant ${input.variantCode} for this product:

Product: ${product.name}
Brand: ${product.brand ?? "(unbranded)"}
Category: ${product.category ?? "(uncategorized)"}
Price: ${priceLine}
Rating: ${ratingLine}
Description: ${product.description?.slice(0, 300) ?? "(none)"}

Affiliate URL (embed exactly once): ${input.shortUrl}`;

  return { system, user };
}
