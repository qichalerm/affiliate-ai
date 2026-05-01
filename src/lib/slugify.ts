/**
 * Slugify Thai + English text.
 * - Keeps Thai characters (Unicode range U+0E00–U+0E7F)
 * - Lowercases Latin
 * - Replaces whitespace + punctuation with hyphens
 * - Trims to 96 chars (URL-friendly)
 */
const KEEP = /[฀-๿a-zA-Z0-9\-_]/;

export function slugify(input: string, opts: { maxLen?: number } = {}): string {
  const maxLen = opts.maxLen ?? 96;
  const lowered = input.normalize("NFC").toLowerCase();

  const chars: string[] = [];
  for (const ch of lowered) {
    if (KEEP.test(ch)) {
      chars.push(ch);
    } else {
      chars.push("-");
    }
  }
  return chars
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
}

/**
 * Predictable slug for a Shopee product:
 *   "{brand}-{model}-{externalId}" or "{name-snippet}-{externalId}"
 */
export function productSlug(name: string, externalId: string, brand?: string): string {
  const base = brand ? `${brand} ${name}` : name;
  return `${slugify(base, { maxLen: 80 })}-${externalId.slice(-10)}`;
}

/**
 * Slug for a comparison page: "a-vs-b-${suffix}"
 */
export function comparisonSlug(slugA: string, slugB: string): string {
  return slugify(`${slugA} vs ${slugB}`, { maxLen: 120 });
}
