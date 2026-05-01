/**
 * Formatting helpers — money, percent, dates.
 * All money internally is in satang (1 baht = 100 satang) to avoid float rounding.
 */

const satangFmt = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatBaht(satang: number | null | undefined): string {
  if (satang == null) return "—";
  return satangFmt.format(Math.round(satang / 100));
}

export function satangFromBaht(baht: number): number {
  return Math.round(baht * 100);
}

export function bahtFromSatang(satang: number): number {
  return satang / 100;
}

const percentFmt = new Intl.NumberFormat("th-TH", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return percentFmt.format(ratio);
}

const numberFmt = new Intl.NumberFormat("th-TH");

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return numberFmt.format(n);
}

const dateFmt = new Intl.DateTimeFormat("th-TH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateFmt.format(typeof d === "string" ? new Date(d) : d);
}

/**
 * Compact "ขายแล้ว 1.2k" style.
 */
export function compactCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
