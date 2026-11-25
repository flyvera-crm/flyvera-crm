"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBookings } from "@/lib/booking-store";
import { BookingStatusBadge, bookingTotalLabel, PaymentBadge } from "@/components/bookings/booking-ui";
import { formatDayMonth, initials } from "@/lib/format";

/** The 6 most recently created bookings (same data as the Bookings page). */
export function RecentBookings() {
  const { bookings, today } = useBookings();
  const router = useRouter();
  const recent = [...bookings].sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id)).slice(0, 6);

  return (
    <>
      {/* Mobile: stacked cards */}
      <ul className="divide-y divide-navy-50 md:hidden">
        {recent.map((b) => (
          <li key={b.id} className="relative flex items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <Link href={`/bookings/${b.id}`} className="block truncate font-medium text-navy-900 after:absolute after:inset-0">
                {b.customerName}
              </Link>
              <p className="text-xs text-navy-400">
                {b.destination} · {formatDayMonth(b.departDate)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-semibold tabular-nums text-navy-900">{bookingTotalLabel(b)}</span>
              <BookingStatusBadge status={b.status} />
            </div>
          </li>
        ))}
      </ul>

      {/* Tablet & desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-navy-50 bg-canvas/60 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
              <th className="px-6 py-3">Booking</th>
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3">Trip</th>
              <th className="px-3 py-3">Departs</th>
              <th className="px-3 py-3 text-right">Amount</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {recent.map((b) => (
              <tr
                key={b.id}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("a")) router.push(`/bookings/${b.id}`);
                }}
                className="cursor-pointer transition-colors hover:bg-sky-brand-light/40"
              >
                <td className="whitespace-nowrap px-6 py-3.5 font-mono text-xs text-navy-500">
                  <Link href={`/bookings/${b.id}`} className="hover:text-sky-brand-dark">
                    {b.id}
                  </Link>
                </td>
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-50 text-xs font-semibold text-navy-700">
                      {initials(b.customerName)}
                    </span>
                    <div className="leading-tight">
                      <p className="whitespace-nowrap font-medium text-navy-900">{b.customerName}</p>
                      <p className="text-xs text-navy-400">Agent: {b.agent}</p>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3.5">
                  <p className="font-medium text-navy-700">{b.destination}</p>
                  <p className="text-xs text-navy-400">{b.adults + b.children} travellers</p>
                </td>
                <td className="whitespace-nowrap px-3 py-3.5 text-navy-600">{formatDayMonth(b.departDate)}</td>
                <td className="whitespace-nowrap px-3 py-3.5 text-right font-semibold tabular-nums text-navy-900">
                  {bookingTotalLabel(b)}
                </td>
                <td className="px-6 py-3.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <BookingStatusBadge status={b.status} />
                    <PaymentBadge booking={b} today={today} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
