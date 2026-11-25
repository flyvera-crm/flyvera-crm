// Pure dashboard calculations (no React / browser / server APIs), tested in tests/unit.
// They take the bookings and leads this user is allowed to see (Row Level Security already
// filtered them), so a sales agent's dashboard shows their own numbers and an admin's the agency's.
import type { Booking, Kpi, LabeledValue, Lead, LeadStage, MonthlyRevenue } from "@/types/crm";
import { bookingMoney } from "@/lib/booking-rules";
import { ledgerEntries, monthlyNet } from "@/lib/payment-ledger";
import { addDays } from "@/lib/customer-history";
import { cashCollected, placeOf, salesSummary, type Period } from "@/lib/report-metrics";

export type DashboardAccess = {
  /** Roles that may see prices and payments (not support). */
  money: boolean;
  /** Roles that work with leads (not ticketing or finance). */
  leads: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Month to date, and the same stretch of the previous month (1st → same day, capped at month end). */
export function monthToDate(today: string): { current: Period; previous: Period } {
  const [y, m, d] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const pd = Math.min(d, daysInMonth(py, pm));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    current: { from: `${y}-${pad(m)}-01`, to: today },
    previous: { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(pd)}` },
  };
}

/** % change from `before` to `now`, one decimal; null when there's nothing to compare with. */
export function percentChange(now: number, before: number): number | null {
  if (before === 0) return null;
  return round1(((now - before) / Math.abs(before)) * 100);
}

const OPEN_STAGES: LeadStage[] = ["New", "Contacted", "Quoted", "Negotiation"];
export const isOpenLead = (l: Lead) => OPEN_STAGES.includes(l.stage);

/** Open leads whose next follow-up is today or overdue, most overdue first. */
export function followUpsDue(leads: Lead[], today: string) {
  return leads
    .filter((l) => isOpenLead(l) && !!l.nextFollowUp && l.nextFollowUp <= today)
    .sort((a, b) => a.nextFollowUp!.localeCompare(b.nextFollowUp!) || a.id.localeCompare(b.id));
}

/** Won ÷ (won + lost) for leads created in the period, as a percentage; null when none closed. */
export function conversionRate(leads: Lead[], p: Period): number | null {
  const cohort = leads.filter((l) => l.created >= p.from && l.created <= p.to);
  const won = cohort.filter((l) => l.stage === "Won").length;
  const lost = cohort.filter((l) => l.stage === "Lost").length;
  return won + lost ? round1((won / (won + lost)) * 100) : null;
}

/** Net money received per month (payments − paid refunds), oldest → newest. */
export function revenueSeries(bookings: Booking[], today: string, months = 12): MonthlyRevenue[] {
  return monthlyNet(ledgerEntries(bookings), today, months).map((m) => ({ month: m.label, revenue: m.value }));
}

/** Current lead pipeline: count and estimated value (budget) per stage. */
export function leadPipeline(leads: Lead[]) {
  const stages: LeadStage[] = [...OPEN_STAGES, "Won"];
  return stages.map((stage) => {
    const inStage = leads.filter((l) => l.stage === stage);
    return { stage, count: inStage.length, value: Math.round(inStage.reduce((s, l) => s + (l.budget || 0), 0) * 100) / 100 };
  });
}

/** Destinations of bookings created this month (not cancelled), by number of bookings. */
export function destinationsThisMonth(bookings: Booking[], today: string, limit = 5): LabeledValue[] {
  const { current } = monthToDate(today);
  const counts = new Map<string, number>();
  for (const b of bookings) {
    if (b.status === "Cancelled" || b.created < current.from || b.created > current.to) continue;
    const place = placeOf(b.destination);
    counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Monthly counts / values for the last `months` months (for the small trend lines on the cards). */
function monthlyTrend(today: string, months: number, value: (from: string, to: string) => number) {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (months - 1 - i), 1));
    const from = d.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return value(from, end < today ? end : today);
  });
}

/**
 * The four headline cards for this user. Money cards only for roles that see money, lead cards only
 * for roles with leads; the first four that apply are shown.
 */
export function dashboardKpis(bookings: Booking[], leads: Lead[], today: string, access: DashboardAccess): Kpi[] {
  const { current, previous } = monthToDate(today);
  const period = "vs same days last month";
  const cards: Kpi[] = [];

  if (access.money) {
    const now = cashCollected(bookings, current);
    cards.push({
      label: "Money received this month",
      value: now,
      format: "currency",
      delta: percentChange(now, cashCollected(bookings, previous)),
      period,
      icon: "wallet",
      trend: monthlyTrend(today, 6, (from, to) => cashCollected(bookings, { from, to })),
    });
    const booked = salesSummary(bookings, current).value;
    cards.push({
      label: "Booked value this month",
      value: booked,
      format: "currency",
      delta: percentChange(booked, salesSummary(bookings, previous).value),
      period,
      icon: "chart",
      trend: monthlyTrend(today, 6, (from, to) => salesSummary(bookings, { from, to }).value),
    });
  }

  const newBookings = salesSummary(bookings, current).count;
  cards.push({
    label: "New bookings this month",
    value: newBookings,
    format: "number",
    delta: percentChange(newBookings, salesSummary(bookings, previous).count),
    period,
    icon: "calendar",
    trend: monthlyTrend(today, 6, (from, to) => salesSummary(bookings, { from, to }).count),
  });

  if (access.leads) {
    const last90 = { from: addDays(today, -89), to: today };
    const prior90 = { from: addDays(today, -179), to: addDays(today, -90) };
    const rate = conversionRate(leads, last90);
    const before = conversionRate(leads, prior90);
    cards.push({
      label: "Lead conversion (90 days)",
      value: rate ?? 0,
      format: "percent",
      // Percentage points, not % of a %.
      delta: rate !== null && before !== null ? round1(rate - before) : null,
      period: rate === null ? "No leads closed yet" : "won ÷ closed, vs previous 90 days (points)",
      icon: "target",
      trend: [],
    });
    const open = leads.filter(isOpenLead);
    cards.push({
      label: "Open leads",
      value: open.length,
      format: "number",
      delta: null,
      period: "not yet won or lost",
      icon: "users",
      trend: [],
    });
    const due = followUpsDue(leads, today).length;
    cards.push({ label: "Follow-ups due", value: due, format: "number", delta: null, period: "today or overdue", icon: "clock", trend: [], upIsGood: false });
  }

  if (access.money) {
    const outstanding = bookings
      .filter((b) => b.status !== "Cancelled")
      .reduce((s, b) => s + bookingMoney(b).balance, 0);
    cards.push({
      label: "Still to collect",
      value: Math.round(outstanding * 100) / 100,
      format: "currency",
      delta: null,
      period: "balances on active bookings",
      icon: "card",
      trend: [],
      upIsGood: false,
    });
  }

  return cards.slice(0, 4);
}

/* ── Departures ── */

/** A flight segment as loaded for the dashboard (times are the airport's local clock, "YYYY-MM-DDTHH:mm"). */
export type DepartureSegment = {
  bookingDbId: string;
  flight: string; // "QR 15"
  from: string; // IATA
  to: string;
  departsAt: string;
  status: "Confirmed" | "Waitlisted" | "Cancelled" | "Flown";
};

export type Departure =
  | { kind: "flight"; booking: Booking; segment: DepartureSegment; date: string }
  | { kind: "trip"; booking: Booking; date: string };

/**
 * Departures from today through `days` days ahead: recorded flight segments of visible, active bookings,
 * plus bookings departing in the window that have no flights recorded yet. Soonest first.
 */
export function upcomingDepartures(segments: DepartureSegment[], bookings: Booking[], today: string, days = 7): Departure[] {
  const until = addDays(today, days);
  const byDbId = new Map(bookings.filter((b) => b.dbId).map((b) => [b.dbId!, b]));
  const active = (b: Booking) => b.status !== "Cancelled" && b.status !== "Completed";
  const flights: Departure[] = segments
    .filter((s) => s.status !== "Cancelled")
    .map((s) => ({ s, b: byDbId.get(s.bookingDbId), date: s.departsAt.slice(0, 10) }))
    .filter((x): x is { s: DepartureSegment; b: Booking; date: string } => !!x.b && active(x.b) && x.date >= today && x.date <= until)
    .map(({ s, b, date }) => ({ kind: "flight", booking: b, segment: s, date }));
  const withFlights = new Set(segments.map((s) => s.bookingDbId));
  const trips: Departure[] = bookings
    .filter((b) => active(b) && b.departDate >= today && b.departDate <= until && !(b.dbId && withFlights.has(b.dbId)))
    .map((b) => ({ kind: "trip", booking: b, date: b.departDate }));
  const time = (d: Departure) => (d.kind === "flight" ? d.segment.departsAt : `${d.date}T99`);
  return [...flights, ...trips].sort((a, b) => time(a).localeCompare(time(b)) || a.booking.id.localeCompare(b.booking.id));
}

/* ── Activity ── */

/** One line of the dashboard's activity feed (loaded by src/lib/data/dashboard.ts). */
export type ActivityItem = {
  id: string;
  at: string; // ISO timestamp
  who: string;
  text: string;
  target: string; // FV-10481 / LD-2050
  href: string;
  kind: "booking" | "payment" | "ticket" | "lead";
};

/** True when a timeline line mentions money (an amount or currency) — hidden from roles that can't see money. */
export function mentionsMoney(text: string) {
  return /[$€£]|\b(USD|EUR|GBP|AED|SAR|QAR)\b|\b\d[\d,]*\.\d{2}\b/.test(text);
}
