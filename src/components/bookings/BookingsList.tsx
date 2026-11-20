"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Booking, BookingStatus } from "@/types/crm";
import { bookingStore, useBookings } from "@/lib/booking-store";
import { bookingMoney, paymentState } from "@/lib/booking-rules";
import { fold } from "@/lib/customer-search";
import { addDays } from "@/lib/dates";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatCurrency, formatDayMonth, formatMoney } from "@/lib/format";
import { BookingStatusBadge, PaidBar, PaymentBadge, TimingChip } from "./booking-ui";

type Tab = BookingStatus | "All" | "Overdue";
const TABS: Tab[] = ["All", "Overdue", "Pending", "Confirmed", "Ticketed", "Completed", "Cancelled"];

function matches(b: Booking, query: string) {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = fold([b.id, b.title, b.destination, b.customerName, b.customerId, b.quoteId ?? "", b.agent, ...b.services.map((s) => s.ref ?? "")].join(" "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Active trips first (soonest departure on top), then finished/cancelled (most recent first). */
function sortBookings(a: Booking, b: Booking) {
  const done = (x: Booking) => (x.status === "Completed" || x.status === "Cancelled" ? 1 : 0);
  return done(a) - done(b) || (done(a) ? b.departDate.localeCompare(a.departDate) : a.departDate.localeCompare(b.departDate));
}

function Stat({ label, value, hint, icon, tone }: { label: string; value: string; hint: string; icon: IconName; tone?: "gold" | "rose" }) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl",
          tone === "gold" ? "bg-navy-900 text-gold-300" : tone === "rose" ? "bg-rose-50 text-rose-600" : "bg-navy-50 text-navy-700",
        )}
      >
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-navy-500">{label}</p>
        <p className="text-xl font-semibold tracking-tight text-navy-900">{value}</p>
        <p className="truncate text-xs text-navy-400">{hint}</p>
      </div>
    </Card>
  );
}

export function BookingsList() {
  const { bookings, today, addedIds, changedCount } = useBookings();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("All");
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => [...bookings].sort(sortBookings), [bookings]);
  const active = sorted.filter((b) => b.status !== "Cancelled");
  const overdue = sorted.filter((b) => paymentState(b, today) === "Overdue");
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: sorted.length, Overdue: overdue.length };
    sorted.forEach((b) => (c[b.status] = (c[b.status] ?? 0) + 1));
    return c;
  }, [sorted, overdue.length]);
  const visible = sorted.filter(
    (b) => (tab === "All" || (tab === "Overdue" ? paymentState(b, today) === "Overdue" : b.status === tab)) && matches(b, query),
  );

  const upcoming = today ? active.filter((b) => b.status !== "Completed" && b.departDate >= today && b.departDate <= addDays(today, 30)) : [];
  const outstanding = active.reduce((s, b) => s + bookingMoney(b).balance, 0);
  const booked = active.reduce((s, b) => s + bookingMoney(b).total, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Booked value" value={formatCurrency(booked, { compact: true })} hint="Excluding cancellations" icon="wallet" tone="gold" />
        <Stat label="Departing in 30 days" value={today ? String(upcoming.length) : "—"} hint="Check documents are ready" icon="plane" />
        <Stat label="Outstanding balance" value={formatCurrency(outstanding, { compact: true })} hint="Still to collect" icon="card" />
        <Stat
          label="Overdue payments"
          value={today ? String(overdue.length) : "—"}
          hint={overdue.length ? "Chase these today" : "All payments on track"}
          icon="alert"
          tone={overdue.length ? "rose" : undefined}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-navy-50 p-4 sm:p-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filter bookings">
            {TABS.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={tab === s}
                onClick={() => setTab(s)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  tab === s ? "bg-navy-900 text-white" : s === "Overdue" && counts.Overdue ? "text-rose-600 hover:bg-rose-50" : "text-navy-500 hover:bg-navy-50 hover:text-navy-900",
                )}
              >
                {s === "Overdue" ? "Payment overdue" : s}
                <span className={cn("rounded-full px-1.5 text-xs", tab === s ? "bg-white/20" : "bg-navy-50 text-navy-500")}>{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="relative block min-w-0 2xl:w-80">
            <span className="sr-only">Search bookings</span>
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search booking, customer, PNR…"
              className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
            />
          </label>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Icon name="calendar" size={28} className="text-navy-300" />
            <p className="mt-3 font-semibold text-navy-900">No bookings here</p>
            <p className="mt-1 text-sm text-navy-400">Try another tab or search.</p>
          </div>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-navy-50 md:hidden">
              {visible.map((b) => (
                <li key={b.id} className="relative px-4 py-4 active:bg-sky-brand-light/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-navy-400">{b.id}</p>
                      <Link href={`/bookings/${b.id}`} className="block truncate font-semibold text-navy-900 after:absolute after:inset-0">
                        {b.title}
                      </Link>
                      <p className="truncate text-sm text-navy-500">
                        {b.customerName} · {formatDayMonth(b.departDate)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums text-navy-900">{formatMoney(bookingMoney(b).total)}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <TimingChip booking={b} today={today} />
                    <PaymentBadge booking={b} today={today} />
                  </div>
                </li>
              ))}
            </ul>

            {/* Tablet & desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Bookings</caption>
                <thead>
                  <tr className="border-b border-navy-50 bg-canvas/60 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
                    <th scope="col" className="py-3 pl-6 pr-3">Booking</th>
                    <th scope="col" className="hidden px-3 py-3 lg:table-cell">Customer</th>
                    <th scope="col" className="px-3 py-3">Departure</th>
                    <th scope="col" className="hidden w-44 px-3 py-3 xl:table-cell">Paid</th>
                    <th scope="col" className="px-3 py-3">Status</th>
                    <th scope="col" className="py-3 pl-3 pr-6 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {visible.map((b) => (
                    <tr
                      key={b.id}
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest("a")) router.push(`/bookings/${b.id}`);
                      }}
                      className={cn("group cursor-pointer transition-colors hover:bg-sky-brand-light/40", b.status === "Cancelled" && "opacity-60")}
                    >
                      <td className="py-3.5 pl-6 pr-3">
                        <Link href={`/bookings/${b.id}`} className="font-medium text-navy-900 group-hover:text-sky-brand-dark">
                          {b.title}
                        </Link>
                        <p className="flex items-center gap-1.5 text-xs text-navy-400">
                          <span className="font-mono">{b.id}</span>
                          <span className="lg:hidden">· {b.customerName}</span>
                          {addedIds.has(b.id) && <span className="rounded bg-gold-500 px-1 text-[10px] font-bold uppercase text-navy-950">New</span>}
                        </p>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3.5 lg:table-cell">
                        <p className="font-medium text-navy-700">{b.customerName}</p>
                        <p className="text-xs text-navy-400">
                          {b.destination} · {b.adults + b.children} pax
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <p className="text-navy-700">{formatDayMonth(b.departDate)}</p>
                        <TimingChip booking={b} today={today} />
                      </td>
                      <td className="hidden px-3 py-3.5 xl:table-cell">
                        {b.status !== "Cancelled" && <PaidBar booking={b} />}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col items-start gap-1">
                          <BookingStatusBadge status={b.status} />
                          <PaymentBadge booking={b} today={today} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap py-3.5 pl-3 pr-6 text-right font-semibold tabular-nums text-navy-900">
                        {formatMoney(bookingMoney(b).total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {changedCount > 0 && (
          <div className="border-t border-navy-50 px-6 py-3 text-right text-sm">
            <button
              onClick={() => {
                if (window.confirm(`Undo ${changedCount} change(s) to bookings and restore the demo data?`)) bookingStore.clear();
              }}
              className="text-navy-400 hover:text-rose-600"
            >
              Reset demo data
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
