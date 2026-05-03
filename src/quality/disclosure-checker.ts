/**
 * Affiliate disclosure checker.
 *
 * Thai PDPA + global FTC requirements: every affiliate-revenue post must
 * disclose the relationship. We accept any of the conventional markers
 * (multilingual support since some posts are TH, some EN).
 *
 * If missing, the gate auto-appends a disclosure rather than failing
 * the whole post — disclosure is a fixable issue.
 */

const DISCLOSURE_MARKERS = [
  // Thai
  /#โฆษณา/i,
  /#โฆษณาแฝง/i,
  /#sponsored/i,
  /#ad\b/i,
  /#affiliate/i,
  /#aff\b/i,
  /#promotion/i,
  /\(ค่าคอม\)/i,
  /\(ลิงก์\s*affiliate\)/i,
  /\bได้ค่าคอม\b/i,
  // English
  /#PaidPartnership/i,
  /#paid\s*partnership/i,
  /#commissioned/i,
  /\bI\s+(may\s+)?earn\s+a\s+commission\b/i,
];

export interface DisclosureCheckResult {
  hasDisclosure: boolean;
  matched?: string; // which marker
  /** If missing, this is the suggested disclosure to append. */
  suggestedAppend?: string;
}

const DEFAULT_DISCLOSURE_TH = "\n\n#affiliate (ลิงก์ในโพสต์อาจมีค่าคอมมิชชั่น)";

export function checkDisclosure(text: string): DisclosureCheckResult {
  for (const marker of DISCLOSURE_MARKERS) {
    const m = text.match(marker);
    if (m) return { hasDisclosure: true, matched: m[0] };
  }
  return {
    hasDisclosure: false,
    suggestedAppend: DEFAULT_DISCLOSURE_TH,
  };
}

/**
 * If text lacks disclosure, append the default one and return new text.
 * If already present, return text unchanged.
 */
export function ensureDisclosure(text: string): string {
  const r = checkDisclosure(text);
  if (r.hasDisclosure) return text;
  return text + (r.suggestedAppend ?? "");
}
