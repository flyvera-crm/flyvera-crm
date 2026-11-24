"use client";

import Link from "next/link";
import { useBookingData, useBookings } from "@/lib/booking-store";
import { useQuotations } from "@/lib/quote-store";
import { quoteTotals } from "@/lib/quote-math";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { formatDate, formatMoney } from "@/lib/format";
import { useBookingActions } from "./use-booking-actions";

/** Bookings start from an accepted quotation — this lists the ones not booked yet. */
export function NewBooking() {
  const { quotes, hydrated } = useQuotations();
  const { bookings } = useBookings();
  const { access } = useBookingData();
  const { createFromQuote } = useBookingActions();
  const bookedQuoteIds = new Set(bookings.map((b) => b.quoteId).filter(Boolean));
  const ready = quotes.filter((q) => q.status === "Accepted" && !bookedQuoteIds.has(q.id));

  if (!access.canCreate) {
    return (
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <Icon name="calendar" size={28} className="text-navy-300" />
        <p className="mt-4 font-semibold text-navy-900">Your role can&apos;t create bookings</p>
        <p className="mt-1 max-w-sm text-sm text-navy-400">Bookings are created by sales, ticketing or an admin from accepted quotations.</p>
        <Link href="/bookings" className="mt-5 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800">
          All bookings
        </Link>
      </Card>
    );
  }
  if (!hydrated) return <div className="h-64 animate-pulse rounded-2xl bg-navy-50" aria-busy="true" />;

  return (
    <div className="space-y-6">
      <Card className="flex items-start gap-4 p-5 sm:p-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-900 text-gold-300">
          <Icon name="document" size={20} />
        </span>
        <div className="text-sm text-navy-600">
          <p className="font-semibold text-navy-900">How bookings are created</p>
          <p className="mt-1">
            A booking starts from an <span className="font-semibold">accepted quotation</span>, so prices, services and travellers are
            copied across exactly. If the quote was for a lead, you&apos;ll be asked to save them as a customer first.
          </p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-navy-50 px-5 py-4 sm:px-6">
          <h2 className="font-semibold text-navy-900">Accepted quotations ready to book</h2>
          <p className="mt-0.5 text-sm text-navy-400">{ready.length ? `${ready.length} waiting` : "None waiting right now"}</p>
        </div>
        {ready.length ? (
          <ul className="divide-y divide-navy-50">
            {ready.map((q) => (
              <li key={q.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <Link href={`/quotations/${q.id}`} className="font-medium text-navy-900 hover:text-sky-brand-dark">
                    {q.title}
                  </Link>
                  <p className="text-xs text-navy-400">
                    <span className="font-mono">{q.id}</span> · {q.recipient.name} ({q.recipient.kind === "lead" ? "lead" : "customer"}) ·{" "}
                    {q.departDate ? formatDate(q.departDate) : "dates TBC"}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-semibold tabular-nums text-navy-900">{formatMoney(quoteTotals(q.items, q.discount, q.taxRate).total)}</span>
                  <button
                    onClick={() => createFromQuote(q)}
                    className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
                  >
                    <Icon name="check" size={16} className="text-gold-300" strokeWidth={2.5} /> Create booking
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <p className="text-sm text-navy-400">When a customer accepts a quotation, it will appear here.</p>
            <div className="mt-5 flex gap-2">
              <Link href="/quotations" className="rounded-xl border border-navy-100 px-4 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50">
                Quotations awaiting reply
              </Link>
              <Link href="/quotations/new" className="rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800">
                New quotation
              </Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
