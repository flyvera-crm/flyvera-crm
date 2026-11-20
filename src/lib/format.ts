import { siteConfig } from "@/config/site";

export function formatCurrency(value: number, opts: { compact?: boolean } = {}) {
  return new Intl.NumberFormat(siteConfig.locale, {
    style: "currency",
    currency: siteConfig.currency,
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 0,
  }).format(value);
}

/**
 * Exact money for quotations/invoices: shows cents only when there are any
 * ("$2,000" but "$301.50"), so customers never see a rounded figure.
 */
export function formatMoney(value: number) {
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat(siteConfig.locale, {
    style: "currency",
    currency: siteConfig.currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(siteConfig.locale).format(value);
}

// Dates are formatted in UTC so the server and browser always print the same text.
export function formatDate(iso: string) {
  return new Intl.DateTimeFormat(siteConfig.locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** "2026-11-22" → "Nov 22" */
export function formatDayMonth(iso: string) {
  return new Intl.DateTimeFormat(siteConfig.locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  );
}

/** "2021-03-08" → "Mar 2021" */
export function formatMonthYear(iso: string) {
  return new Intl.DateTimeFormat(siteConfig.locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  );
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
