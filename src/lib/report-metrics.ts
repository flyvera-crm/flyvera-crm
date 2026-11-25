// Pure report calculations (no React / browser APIs). Every function takes plain arrays
// plus a period, so the same maths can later run on a server or in a scheduled job.
import type { Booking, Lead, LeadSource, Quotation } from "@/types/crm";
import { bookingMoney } from "@/lib/booking-rules";
import { ledgerEntries } from "@/lib/payment-ledger";
import { addDays } from "@/lib/customer-history";

export type PeriodKey = "30d" | "90d" | "12m" | "all";
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
];

export type Period = { from: string; to: string }; // inclusive ISO dates

export function periodRange(key: PeriodKey, today: string): Period {
  if (key === "30d") return { from: addDays(today, -29), to: today };
  if (key === "90d") return { from: addDays(today, -89), to: today };
  if (key === "12m") return { from: addDays(today, -364), to: today };
  return { from: "0000-01-01", to: today };
}

const inPeriod = (date: string | undefined, p: Period) => !!date && date >= p.from && date <= p.to;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Destination grouping key: "Paris, France" → "Paris". */
export const placeOf = (destination: string) => destination.split(",")[0].trim();

/* ── Sales (bookings created in the period) ── */

export function salesSummary(bookings: Booking[], p: Period) {
  const made = bookings.filter((b) => inPeriod(b.created, p));
  const live = made.filter((b) => b.status !== "Cancelled");
  const cancelled = made.filter((b) => b.status === "Cancelled");
  const money = live.map(bookingMoney);
  const value = round2(money.reduce((s, m) => s + m.total, 0));
  const taxable = money.reduce((s, m) => s + m.taxable, 0);
  const profit = round2(money.reduce((s, m) => s + m.profit, 0));
  return {
    count: live.length,
    value,
    profit,
    margin: pct(profit, taxable),
    average: live.length ? round2(value / live.length) : 0,
    cancelledCount: cancelled.length,
    cancelledValue: round2(cancelled.reduce((s, b) => s + bookingMoney(b).total, 0)),
  };
}

/** Net cash (payments − refunds) dated inside the period. */
export function cashCollected(bookings: Booking[], p: Period) {
  return round2(ledgerEntries(bookings).filter((e) => inPeriod(e.payment.date, p)).reduce((s, e) => s + e.signedAmount, 0));
}

/** One point per month from the period start (max 12 months back) to `to`. */
export function monthlySales(bookings: Booking[], p: Period) {
  const earliest = bookings.reduce((m, b) => (b.created < m ? b.created : m), p.to);
  const start = p.from > earliest ? p.from : earliest;
  const [ty, tm] = p.to.split("-").map(Number);
  const [sy, sm] = start.split("-").map(Number);
  const count = Math.min((ty - sy) * 12 + (tm - sm) + 1, 12);
  return Array.from({ length: Math.max(count, 1) }, (_, i) => {
    const d = new Date(Date.UTC(ty, tm - 1 - (count - 1 - i), 1));
    const key = d.toISOString().slice(0, 7);
    const live = bookings.filter((b) => b.status !== "Cancelled" && b.created.startsWith(key) && inPeriod(b.created, p));
    const money = live.map(bookingMoney);
    return {
      key,
      label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      value: round2(money.reduce((s, m) => s + m.total, 0)),
      profit: round2(money.reduce((s, m) => s + m.profit, 0)),
      count: live.length,
    };
  });
}

export function topDestinations(bookings: Booking[], p: Period, limit = 6) {
  const groups = new Map<string, { place: string; value: number; profit: number; count: number }>();
  for (const b of bookings) {
    if (b.status === "Cancelled" || !inPeriod(b.created, p)) continue;
    const m = bookingMoney(b);
    const key = placeOf(b.destination);
    const g = groups.get(key) ?? { place: key, value: 0, profit: 0, count: 0 };
    g.value = round2(g.value + m.total);
    g.profit = round2(g.profit + m.profit);
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

export function topCustomers(bookings: Booking[], p: Period, limit = 5) {
  const groups = new Map<string, { id: string; name: string; bookings: number; value: number; paid: number }>();
  for (const b of bookings) {
    if (b.status === "Cancelled" || !inPeriod(b.created, p)) continue;
    const m = bookingMoney(b);
    const g = groups.get(b.customerId) ?? { id: b.customerId, name: b.customerName, bookings: 0, value: 0, paid: 0 };
    g.bookings += 1;
    g.value = round2(g.value + m.total);
    g.paid = round2(g.paid + m.paid);
    groups.set(b.customerId, g);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

/* ── Quotations ── */

/** Quotes sent in the period, how many were accepted / declined, and how many became bookings. */
export function quoteFunnel(quotes: Quotation[], bookings: Booking[], p: Period) {
  const sent = quotes.filter((q) => inPeriod(q.sentAt, p));
  const accepted = sent.filter((q) => q.status === "Accepted");
  const declined = sent.filter((q) => q.status === "Declined");
  const bookedIds = new Set(bookings.map((b) => b.quoteId).filter(Boolean));
  const booked = accepted.filter((q) => bookedIds.has(q.id));
  return {
    sent: sent.length,
    accepted: accepted.length,
    declined: declined.length,
    booked: booked.length,
    acceptanceRate: pct(accepted.length, accepted.length + declined.length),
  };
}

/* ── Leads (cohort: leads created in the period) ── */

export function leadSummary(leads: Lead[], p: Period) {
  const cohort = leads.filter((l) => inPeriod(l.created, p));
  const won = cohort.filter((l) => l.stage === "Won").length;
  const lost = cohort.filter((l) => l.stage === "Lost").length;
  return { total: cohort.length, won, lost, open: cohort.length - won - lost, winRate: pct(won, won + lost) };
}

export function leadSources(leads: Lead[], p: Period) {
  const groups = new Map<LeadSource, { source: LeadSource; leads: number; won: number; lost: number }>();
  for (const l of leads) {
    if (!inPeriod(l.created, p)) continue;
    const g = groups.get(l.source) ?? { source: l.source, leads: 0, won: 0, lost: 0 };
    g.leads += 1;
    if (l.stage === "Won") g.won += 1;
    if (l.stage === "Lost") g.lost += 1;
    groups.set(l.source, g);
  }
  return [...groups.values()].map((g) => ({ ...g, winRate: pct(g.won, g.won + g.lost) })).sort((a, b) => b.leads - a.leads);
}

export function lostReasons(leads: Lead[], p: Period) {
  const counts = new Map<string, number>();
  for (const l of leads) {
    if (l.stage !== "Lost" || !inPeriod(l.created, p)) continue;
    const r = l.lostReason ?? "Not recorded";
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

/* ── Team ── */

export function teamPerformance(agents: string[], data: { bookings: Booking[]; quotes: Quotation[]; leads: Lead[] }, p: Period) {
  return agents.map((agent) => {
    const bookings = data.bookings.filter((b) => b.agent === agent);
    const sales = salesSummary(bookings, p);
    const leads = leadSummary(data.leads.filter((l) => l.agent === agent), p);
    const funnel = quoteFunnel(data.quotes.filter((q) => q.agent === agent), data.bookings, p);
    return {
      agent,
      leads: leads.total,
      leadWinRate: leads.winRate,
      quotesSent: funnel.sent,
      quotesAccepted: funnel.accepted,
      bookings: sales.count,
      value: sales.value,
      profit: sales.profit,
      margin: sales.margin,
      cash: cashCollected(bookings, p),
    };
  });
}

/* ── CSV ── */

/**
 * Spreadsheet apps run cells that start with = + - @ as formulas ("CSV injection"), and turn
 * "+971…" phone numbers into plain numbers. A leading apostrophe keeps such text cells as text.
 * Numbers (including negative amounts) are left as numbers.
 */
export function safeCell(value: string | number | null | undefined) {
  if (typeof value !== "string") return value;
  return /^[=+@\t\r-]/.test(value) ? `'${value}` : value;
}

/** Builds CSV text: formula-safe, and values with commas, quotes or line breaks are quoted. */
export function toCsv(rows: (string | number | null | undefined)[][]) {
  const cell = (raw: string | number | null | undefined) => {
    const v = safeCell(raw);
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export function bookingsCsv(bookings: Booking[], p: Period) {
  const header = ["Booking", "Created", "Customer", "Destination", "Departure", "Status", "Agent", "Total", "Paid", "Balance", "Supplier cost", "Profit"];
  const rows = bookings
    .filter((b) => inPeriod(b.created, p))
    .sort((a, b) => a.created.localeCompare(b.created))
    .map((b) => {
      const m = bookingMoney(b);
      return [b.id, b.created, b.customerName, b.destination, b.departDate, b.status, b.agent, m.total, m.paid, m.balance, m.cost, b.status === "Cancelled" ? 0 : m.profit];
    });
  return toCsv([header, ...rows]);
}
