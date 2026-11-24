"use client";

import Link from "next/link";
import { useBookings } from "@/lib/booking-store";
import { bookingMoney, isRefund } from "@/lib/booking-rules";
import { balanceAfter, receiptNumber } from "@/lib/payment-ledger";
import { siteConfig } from "@/config/site";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { formatDate, formatMoney } from "@/lib/format";

/** Printable payment receipt (or refund note) for one payment on a booking. */
export function Receipt({ bookingId, paymentId }: { bookingId: string; paymentId: string }) {
  const { bookings } = useBookings();
  const b = bookings.find((x) => x.id === bookingId);
  const p = b?.payments.find((x) => x.id === paymentId);

  if (!b || !p || b.moneyHidden) {
    return (
      <Card className="flex flex-col items-center px-6 py-20 text-center">
        <Icon name="document" size={28} className="text-navy-300" />
        <h1 className="mt-4 text-xl font-semibold text-navy-900">Receipt not found</h1>
        <p className="mt-2 text-sm text-navy-400">There&apos;s no such payment on a booking you can see.</p>
        <Link href="/payments" className="mt-6 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
          All payments
        </Link>
      </Card>
    );
  }

  const refund = isRefund(p);
  const m = bookingMoney(b);
  const no = receiptNumber(b.id, p.id);
  const remaining = balanceAfter(b, p.id);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/bookings/${b.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-900">
          <Icon name="arrowRight" size={16} className="rotate-180" /> Booking {b.id}
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
        >
          <Icon name="document" size={16} className="text-gold-300" /> Print / PDF
        </button>
      </div>

      <article className="overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <header className="flex flex-col gap-4 bg-navy-900 px-6 py-6 text-white sm:flex-row sm:items-start sm:justify-between sm:px-10">
          <div>
            <p className="text-2xl font-bold tracking-[0.2em]">{siteConfig.name}</p>
            <p className="text-xs font-medium uppercase tracking-wider text-gold-300">{refund ? "Refund note" : "Payment receipt"}</p>
          </div>
          <div className="sm:text-right">
            <p className="font-mono text-lg">{no}</p>
            <p className="text-sm text-navy-200">{formatDate(p.date)}</p>
          </div>
        </header>

        <div className="space-y-8 px-6 py-8 sm:px-10">
          <div className="text-center">
            <p className="text-sm text-navy-500">{refund ? "Amount refunded" : "Amount received"}</p>
            <p className={`mt-1 text-4xl font-bold tracking-tight ${refund ? "text-rose-600" : "text-navy-900"}`}>{formatMoney(p.amount)}</p>
            <p className="mt-1 text-sm text-navy-500">
              by {p.method}
              {p.note && <> · {p.note}</>}
            </p>
            {p.corrected && (
              <p className="mt-2 text-xs text-amber-700">
                This payment was corrected by Finance after it was first recorded. The original values and the reason are kept in the
                agency&apos;s audit log.
              </p>
            )}
          </div>

          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            <Item label={refund ? "Refunded to" : "Received from"}>
              <span className="font-semibold">{b.customerName}</span>
              <span className="block text-navy-500">{b.customerEmail ?? b.customerPhone}</span>
            </Item>
            <Item label="For booking">
              <span className="font-semibold">{b.title}</span>
              <span className="block text-navy-500">
                {b.id} · {formatDate(b.departDate)}
                {b.returnDate && <> – {formatDate(b.returnDate)}</>}
              </span>
            </Item>
            <Item label="Booking total">{formatMoney(m.total)}</Item>
            <Item label={refund ? "Kept after this refund" : "Balance remaining after this payment"}>
              {refund ? formatMoney(m.paid) : remaining > 0 ? formatMoney(remaining) : <span className="font-semibold text-emerald-700">Paid in full</span>}
            </Item>
          </dl>

          <footer className="flex flex-col gap-4 border-t border-navy-100 pt-6 text-xs text-navy-500 sm:flex-row sm:justify-between">
            <p>Thank you for travelling with {siteConfig.name}. Please keep this {refund ? "note" : "receipt"} for your records.</p>
            <p className="sm:text-right">
              Issued by <span className="font-semibold text-navy-900">{b.agent}</span>
              <span className="block">{siteConfig.product}</span>
            </p>
          </footer>
        </div>
      </article>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-navy-400">{label}</dt>
      <dd className="mt-1 text-navy-900">{children}</dd>
    </div>
  );
}
