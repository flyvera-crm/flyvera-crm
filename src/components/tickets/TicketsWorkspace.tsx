"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TicketStatus } from "@/types/ticketing";
import type { TicketListItem } from "@/lib/data/ticketing";
import { useBookings } from "@/lib/booking-store";
import { flightTicketsBlocker } from "@/lib/booking-rules";
import { fold } from "@/lib/customer-search";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatDate, formatMoney } from "@/lib/format";
import { TimingChip } from "@/components/bookings/booking-ui";

const TONE: Record<TicketStatus, BadgeTone> = { Issued: "success", Voided: "neutral", Refunded: "warning", Exchanged: "info" };
const TABS: (TicketStatus | "All")[] = ["All", "Issued", "Voided", "Refunded", "Exchanged"];

/** Tickets page: bookings that still need tickets, then every recorded ticket (search + status filter). */
export function TicketsWorkspace({ tickets }: { tickets: TicketListItem[] }) {
  const { bookings, today } = useBookings();
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [query, setQuery] = useState("");

  // Confirmed / ticketed bookings with flights where someone still has no issued ticket.
  const queue = useMemo(
    () =>
      bookings
        .filter((b) => (b.status === "Confirmed" || b.status === "Ticketed") && b.ticketing?.visible && flightTicketsBlocker(b))
        .sort((a, b) => a.departDate.localeCompare(b.departDate)),
    [bookings],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: tickets.length };
    tickets.forEach((t) => (c[t.status] = (c[t.status] ?? 0) + 1));
    return c;
  }, [tickets]);

  const visible = tickets.filter((t) => {
    if (tab !== "All" && t.status !== tab) return false;
    const q = fold(query.trim());
    if (!q) return true;
    const hay = fold([t.ticketNumber, t.passengerName, t.bookingCode, t.bookingTitle, t.recordLocator ?? "", t.airline].join(" "));
    const digits = q.replace(/\D/g, "");
    return q.split(/\s+/).every((w) => hay.includes(w)) || (digits.length >= 4 && t.ticketNumber.includes(digits));
  });

  const issued = tickets.filter((t) => t.status === "Issued");
  const month = today?.slice(0, 7);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Needs ticketing" value={String(queue.length)} hint="Confirmed bookings missing tickets" icon="alert" tone={queue.length ? "rose" : undefined} />
        <Stat label="Issued tickets" value={String(issued.length)} hint="Currently valid" icon="ticket" />
        <Stat label="Issued this month" value={month ? String(issued.filter((t) => t.issuedAt.startsWith(month)).length) : "—"} hint="By issue date" icon="calendar" />
        <Stat label="Value issued" value={formatMoney(issued.reduce((s, t) => s + t.total, 0))} hint="Fares + taxes of valid tickets" icon="wallet" />
      </div>

      {queue.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-navy-50 px-5 py-4 sm:px-6">
            <h2 className="font-semibold text-navy-900">Needs ticketing</h2>
            <p className="mt-0.5 text-sm text-navy-400">Soonest departure first. Record each ticket from the airline or GDS on the booking.</p>
          </div>
          <ul className="divide-y divide-navy-50">
            {queue.map((b) => (
              <li key={b.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <p className="font-medium text-navy-900">
                    {b.customerName} · <span className="text-navy-500">{b.title}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-navy-400">
                    <span className="font-mono">{b.id}</span> · departs {formatDate(b.departDate)}
                    <TimingChip booking={b} today={today} />
                    <span className="text-amber-700">{flightTicketsBlocker(b)}</span>
                  </p>
                </div>
                <Link href={`/bookings/${b.id}#ticketing`} className="shrink-0 rounded-xl bg-navy-900 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-navy-800">
                  Open ticketing
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-navy-50 p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filter tickets">
            {TABS.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={tab === s}
                onClick={() => setTab(s)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  tab === s ? "bg-navy-900 text-white" : "text-navy-500 hover:bg-navy-50 hover:text-navy-900",
                )}
              >
                {s}
                <span className={cn("rounded-full px-1.5 text-xs", tab === s ? "bg-white/20" : "bg-navy-50 text-navy-500")}>{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="relative block min-w-0 xl:w-80">
            <span className="sr-only">Search tickets</span>
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ticket number, passenger, PNR, booking…"
              className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
            />
          </label>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Icon name="ticket" size={28} className="text-navy-300" />
            <p className="mt-3 font-semibold text-navy-900">{tickets.length ? "No tickets match" : "No tickets recorded yet"}</p>
            <p className="mt-1 text-sm text-navy-400">
              {tickets.length ? "Try another tab or search." : "Tickets are recorded on each booking once the airline has issued them."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-50 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
                  <th className="py-3 pl-6 pr-3">Ticket</th>
                  <th className="px-3 py-3">Passenger</th>
                  <th className="px-3 py-3">Booking</th>
                  <th className="hidden px-3 py-3 lg:table-cell">PNR</th>
                  <th className="hidden px-3 py-3 md:table-cell">Issued</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="py-3 pl-3 pr-6">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {visible.map((t) => (
                  <tr key={t.id} className="hover:bg-sky-brand-light/30">
                    <td className="whitespace-nowrap py-3 pl-6 pr-3 font-mono text-navy-900">
                      {t.ticketNumber} <span className="text-xs text-navy-400">{t.airline}</span>
                    </td>
                    <td className="px-3 py-3 text-navy-700">{t.passengerName}</td>
                    <td className="px-3 py-3">
                      <Link href={`/bookings/${t.bookingCode}#ticketing`} className="font-mono text-sky-brand-dark hover:underline">
                        {t.bookingCode}
                      </Link>
                      <span className="block max-w-56 truncate text-xs text-navy-400">{t.bookingTitle}</span>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 font-mono text-navy-600 lg:table-cell">{t.recordLocator ?? "—"}</td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-navy-600 md:table-cell">{formatDate(t.issuedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-navy-900">{formatMoney(t.total)}</td>
                    <td className="py-3 pl-3 pr-6">
                      <Badge tone={TONE[t.status]}>{t.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, icon, tone }: { label: string; value: string; hint: string; icon: IconName; tone?: "rose" }) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl", tone === "rose" ? "bg-rose-50 text-rose-600" : "bg-navy-50 text-navy-700")}>
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
