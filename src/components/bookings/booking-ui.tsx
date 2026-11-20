// Small presentational pieces shared by the bookings list, detail page, dashboard and profiles.
import type { Booking, BookingStatus } from "@/types/crm";
import { bookingMoney, paymentState, tripTiming, type PaymentState } from "@/lib/booking-rules";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/icons";
import { cn, formatMoney } from "@/lib/format";

export const bookingTone: Record<BookingStatus, BadgeTone> = {
  Pending: "warning",
  Confirmed: "info",
  Ticketed: "success",
  Completed: "neutral",
  Cancelled: "danger",
};

const paymentTone: Record<PaymentState, BadgeTone> = {
  "Paid in full": "success",
  "Part paid": "info",
  Unpaid: "neutral",
  Overdue: "danger",
  Cancelled: "neutral",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge tone={bookingTone[status]}>{status}</Badge>;
}

export function PaymentBadge({ booking, today }: { booking: Booking; today: string | null }) {
  const state = paymentState(booking, today);
  if (state === "Cancelled") return null;
  return <Badge tone={paymentTone[state]}>{state}</Badge>;
}

/** Thin progress bar: how much of the total has been paid. */
export function PaidBar({ booking, className }: { booking: Booking; className?: string }) {
  const m = bookingMoney(booking);
  return (
    <div className={className}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-navy-100"
        role="progressbar"
        aria-valuenow={Math.round(m.percentPaid)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${Math.round(m.percentPaid)}% paid`}
      >
        <div
          className={cn("h-full rounded-full", m.balance <= 0 ? "bg-emerald-500" : "bg-sky-brand-dark")}
          style={{ width: `${m.percentPaid}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-navy-400">
        {formatMoney(m.paid)} of {formatMoney(m.total)}
      </p>
    </div>
  );
}

/** "Departs in 8 days" (amber when within 2 weeks), "Travelling now", "Returned". */
export function TimingChip({ booking, today }: { booking: Booking; today: string | null }) {
  const t = tripTiming(booking, today);
  if (!t) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        t.label === "Travelling now" ? "bg-sky-brand-light text-sky-brand-dark" : t.urgent ? "bg-amber-50 text-amber-700" : "bg-navy-50 text-navy-500",
      )}
    >
      <Icon name={t.label === "Travelling now" ? "plane" : "clock"} size={12} />
      {t.label}
    </span>
  );
}
