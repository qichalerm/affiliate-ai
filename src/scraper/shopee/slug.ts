/**
 * Generate URL-safe slug from product name + brand + external ID.
 * Preserves Thai characters (web is multilingual; users search in Thai).
 */

const SAFE_CHARS = /[^\p{L}\p{N}\-]/gu;

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(SAFE_CHARS, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200);
}

export function productSlug(name: string, externalId: string, brand?: string | null): string {
  const parts: string[] = [];
  if (brand) parts.push(brand);
  parts.push(name);
  // Last 10 digits of external id ensures uniqueness without long slug
  const idTail = externalId.slice(-10);
  parts.push(idTail);
  return slugify(parts.join(" "));
}
