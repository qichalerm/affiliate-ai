/**
 * Schema.org JSON-LD builders for rich snippets.
 *
 * Each page type gets the right schema:
 *  - review:     Product + AggregateRating + Offer + BreadcrumbList
 *  - comparison: Product (×2) + BreadcrumbList
 *  - best_of:    ItemList (with ListItem references) + BreadcrumbList
 */

import { env } from "../lib/env.ts";

const SITE = `https://${env.DOMAIN_NAME}`;

interface BreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumbList(items: BreadcrumbItem[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

interface ProductSchemaInput {
  name: string;
  brand?: string | null;
  image?: string[] | string | null;
  description?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  priceBaht: number;
  inStock: boolean;
  sellerName?: string | null;
}

export function buildProductSchema(input: ProductSchemaInput) {
  const out: Record<string, unknown> = {
    "@type": "Product",
    name: input.name,
    image: Array.isArray(input.image) ? input.image : input.image ? [input.image] : undefined,
  };
  if (input.brand) out.brand = { "@type": "Brand", name: input.brand };
  if (input.description) out.description = input.description;
  if (input.rating != null && input.ratingCount != null && input.ratingCount > 0) {
    out.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: input.rating,
      reviewCount: input.ratingCount,
    };
  }
  out.offers = {
    "@type": "Offer",
    priceCurrency: "THB",
    price: input.priceBaht,
    availability: input.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    ...(input.sellerName ? { seller: { "@type": "Organization", name: input.sellerName } } : {}),
  };
  return out;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export function buildFaqPageSchema(entries: FaqEntry[]) {
  if (entries.length === 0) return null;
  return {
    "@type": "FAQPage",
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: e.answer,
      },
    })),
  };
}

interface ItemListInput {
  items: Array<{
    rank: number;
    name: string;
    url?: string;
    image?: string | null;
  }>;
}

export function buildItemListSchema(input: ItemListInput) {
  return {
    "@type": "ItemList",
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: input.items.length,
    itemListElement: input.items.map((item) => ({
      "@type": "ListItem",
      position: item.rank,
      name: item.name,
      ...(item.url ? { url: item.url } : {}),
      ...(item.image ? { image: item.image } : {}),
    })),
  };
}

/**
 * Combine multiple schemas under a single "@graph" — Google understands this
 * better than multiple separate <script> tags.
 */
export function combineSchemas(...schemas: Array<Record<string, unknown> | null>): Record<string, unknown> {
  const valid = schemas.filter((s): s is Record<string, unknown> => s !== null);
  return {
    "@context": "https://schema.org",
    "@graph": valid,
  };
}

/**
 * Build common review-page schema (Product + Breadcrumb + optional FAQ).
 */
export function buildReviewPageSchema(input: {
  product: ProductSchemaInput;
  pageUrl: string;
  pageName: string;
  faq?: FaqEntry[];
}) {
  return combineSchemas(
    buildProductSchema(input.product),
    buildBreadcrumbList([
      { name: "หน้าแรก", url: `${SITE}/` },
      { name: "รีวิว", url: `${SITE}/best` },
      { name: input.pageName, url: input.pageUrl },
    ]),
    input.faq && input.faq.length > 0 ? buildFaqPageSchema(input.faq) : null,
  );
}

export function buildComparisonPageSchema(input: {
  productA: ProductSchemaInput;
  productB: ProductSchemaInput;
  pageUrl: string;
  pageName: string;
}) {
  return combineSchemas(
    buildProductSchema(input.productA),
    buildProductSchema(input.productB),
    buildBreadcrumbList([
      { name: "หน้าแรก", url: `${SITE}/` },
      { name: "เปรียบเทียบ", url: `${SITE}/best` },
      { name: input.pageName, url: input.pageUrl },
    ]),
  );
}

export function buildBestOfPageSchema(input: {
  items: Array<{
    rank: number;
    name: string;
    url?: string;
    image?: string | null;
  }>;
  pageUrl: string;
  pageName: string;
  categoryName: string;
}) {
  return combineSchemas(
    buildItemListSchema({ items: input.items }),
    buildBreadcrumbList([
      { name: "หน้าแรก", url: `${SITE}/` },
      { name: input.categoryName, url: `${SITE}/best` },
      { name: input.pageName, url: input.pageUrl },
    ]),
  );
}
