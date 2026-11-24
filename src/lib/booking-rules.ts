// Pure booking logic (no React / browser APIs): money, payment state, trip timing,
// what the next step is and what blocks it. Can later run on a server unchanged.
import type { Booking, BookingPayment, BookingStatus, PaymentMethod } from "@/types/crm";
import { quoteTotals } from "@/lib/quote-math";
import { addDays } from "@/lib/customer-history";

export const PAYMENT_METHODS: PaymentMethod[] = ["Card", "Bank transfer", "Cash", "Other"];
export const BOOKING_FLOW: BookingStatus[] = ["Pending", "Confirmed", "Ticketed", "Completed"];
export const CANCEL_REASONS = [
  "Customer's plans changed",
  "Found a cheaper option",
  "Visa refused",
  "Medical or family reasons",
  "Supplier cancelled",
  "Other",
];
/** Deposit is due this many days after booking; the balance this many days before departure. */
export const DEPOSIT_DAYS = 7;
export const BALANCE_DAYS_BEFORE_DEPARTURE = 30;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const isRefund = (p: BookingPayment) => p.kind === "refund";

/** Totals + money in. `paid` is net: payments received minus refunds given back. */
export function bookingMoney(b: Booking) {
  const t = quoteTotals(b.services, b.discount, b.taxRate);
  const received = round2(b.payments.filter((p) => !isRefund(p)).reduce((s, p) => s + p.amount, 0));
  const refunded = round2(b.payments.filter(isRefund).reduce((s, p) => s + p.amount, 0));
  const paid = round2(received - refunded);
  const supplierPaid = round2(b.services.filter((s) => s.supplierPaidOn).reduce((s, x) => s + (x.cost || 0), 0));
  return {
    ...t,
    received,
    refunded,
    paid,
    balance: b.status === "Cancelled" ? 0 : round2(Math.max(t.total - paid, 0)),
    percentPaid: t.total ? Math.min(Math.max((paid / t.total) * 100, 0), 100) : 0,
    supplierPaid,
    supplierOwed: round2(t.cost - supplierPaid),
  };
}

/* ── Refunds (cancelled bookings) ── */

export type RefundState = "To settle" | "Refund requested" | "Refunded" | "Kept as fee" | "Nothing paid";

export function refundState(b: Booking): RefundState | null {
  if (b.status !== "Cancelled") return null;
  const { paid, refunded } = bookingMoney(b);
  // A request waiting for Finance (requested or approved, not yet paid).
  if (b.refundRequests?.some((r) => r.status === "Requested" || r.status === "Approved")) return "Refund requested";
  if (paid <= 0) return refunded > 0 ? "Refunded" : "Nothing paid";
  // Settled with money still held: the rest is kept as a cancellation fee.
  return b.refundSettled ? "Kept as fee" : "To settle";
}

/** Money that can still be refunded: received, minus refunds paid or still pending. */
export function refundableAmount(b: Booking) {
  const { received, refunded } = bookingMoney(b);
  const pending = (b.refundRequests ?? [])
    .filter((r) => r.status === "Requested" || r.status === "Approved")
    .reduce((s, r) => s + r.amount, 0);
  return Math.max(Math.round((received - refunded - pending) * 100) / 100, 0);
}

/* ── Supplier payments ── */

/** Statuses where the agency has committed to suppliers and should pay them. */
export const SUPPLIER_PAYABLE_STATUSES: BookingStatus[] = ["Confirmed", "Ticketed", "Completed"];
/** Suppliers are paid this many days before departure. */
export const SUPPLIER_DAYS_BEFORE_DEPARTURE = 14;

export type PaymentState = "Paid in full" | "Part paid" | "Unpaid" | "Overdue" | "Cancelled";

export function paymentState(b: Booking, today: string | null): PaymentState {
  if (b.status === "Cancelled") return "Cancelled";
  const { paid, balance } = bookingMoney(b);
  if (balance <= 0) return "Paid in full";
  if (today && (b.balanceDue < today || (paid === 0 && b.depositDue < today))) return "Overdue";
  return paid > 0 ? "Part paid" : "Unpaid";
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** Human description of where the trip is in time, e.g. "Departs in 8 days" / "Travelling now". */
export function tripTiming(b: Booking, today: string | null): { label: string; urgent: boolean } | null {
  if (!today || b.status === "Cancelled") return null;
  const end = b.returnDate ?? b.departDate;
  if (today > end) return { label: "Returned", urgent: false };
  if (today >= b.departDate) return { label: "Travelling now", urgent: false };
  const d = daysBetween(today, b.departDate);
  return { label: d === 1 ? "Departs tomorrow" : `Departs in ${d} days`, urgent: d <= 14 };
}

/** The next status in the flow, and what (if anything) blocks moving to it. */
export function nextStep(b: Booking, today: string | null): { next: BookingStatus; action: string; blocker?: string } | null {
  const { balance } = bookingMoney(b);
  switch (b.status) {
    case "Pending":
      return {
        next: "Confirmed",
        action: "Confirm booking",
        blocker: b.payments.length === 0 ? "Record the deposit first." : undefined,
      };
    case "Confirmed": {
      const missing = b.services.filter((s) => !s.ref?.trim()).length;
      return {
        next: "Ticketed",
        action: "Issue tickets & vouchers",
        blocker: missing
          ? `Add supplier references for ${missing} service${missing === 1 ? "" : "s"} first.`
          : balance > 0
            ? "Collect the full balance before issuing tickets."
            : flightTicketsBlocker(b),
      };
    }
    case "Ticketed": {
      const end = b.returnDate ?? b.departDate;
      return {
        next: "Completed",
        action: "Mark trip completed",
        blocker: !today || today <= end ? "Available after the trip ends." : undefined,
      };
    }
    default:
      return null;
  }
}

/**
 * A booking with flights is only "Ticketed" when every passenger on it holds an issued ticket
 * (recorded from the airline / GDS — see migration 16). Bookings without flights skip this.
 */
export function flightTicketsBlocker(b: Booking): string | undefined {
  if (!b.ticketing || !b.services.some((s) => s.type === "Flight")) return undefined;
  const { visible, passengers, ticketedPassengers } = b.ticketing;
  if (!visible) return "Ticketing issues the flight tickets and completes this step.";
  if (passengers === 0) return "Add the passengers and record their flight tickets first.";
  const missing = passengers - ticketedPassengers;
  return missing > 0 ? `Record issued tickets for ${missing} passenger${missing === 1 ? "" : "s"} first.` : undefined;
}

export const STATUS_EVENT: Record<BookingStatus, string> = {
  Pending: "Booking reopened",
  Confirmed: "Booking confirmed",
  Ticketed: "Tickets and vouchers issued",
  Completed: "Trip completed",
  Cancelled: "Booking cancelled",
};

/* ── Payments ── */

export type PaymentFormValues = { amount: string; date: string; method: PaymentMethod; note: string };

export function validatePayment(v: PaymentFormValues, b: Booking, today: string) {
  const errors: Partial<Record<keyof PaymentFormValues, string>> = {};
  const amount = Number(v.amount.replace(/[,\s$]/g, ""));
  const { balance } = bookingMoney(b);
  if (!v.amount.trim()) errors.amount = "Enter the amount received.";
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount above 0.";
  else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) errors.amount = "Use at most 2 decimal places.";
  else if (amount > balance + 0.001) errors.amount = `That's more than the balance due (${balance.toFixed(2)}).`;
  if (!v.date) errors.date = "Enter the payment date.";
  else if (v.date > today) errors.date = "The payment date can't be in the future.";
  else if (v.date < b.created) errors.date = "That's before the booking was created.";
  if (v.note.length > 120) errors.note = "Keep the note under 120 characters.";
  return errors;
}

/* ── Creating a booking ── */

/**
 * Dates for a new booking made from a quotation: deposit due DEPOSIT_DAYS after booking,
 * balance due BALANCE_DAYS_BEFORE_DEPARTURE before departure (never before the deposit).
 * A quotation without dates is booked 60 days out, to be updated with the customer.
 */
export function bookingDates(q: { departDate?: string; returnDate?: string }, today: string) {
  const depositDue = addDays(today, DEPOSIT_DAYS);
  const departOn = q.departDate && q.departDate >= today ? q.departDate : addDays(today, 60);
  const returnOn = q.returnDate && q.returnDate >= departOn ? q.returnDate : undefined;
  const balanceByDeparture = addDays(departOn, -BALANCE_DAYS_BEFORE_DEPARTURE);
  return { departOn, returnOn, depositDue, balanceDue: balanceByDeparture > depositDue ? balanceByDeparture : depositDue };
}

/* ── Correcting a payment (Finance / admin) ── */

export type PaymentCorrectionValues = PaymentFormValues & { reference: string; reason: string };

export function validatePaymentCorrection(v: PaymentCorrectionValues, original: BookingPayment, b: Booking, today: string) {
  const errors: Partial<Record<keyof PaymentCorrectionValues, string>> = {};
  const amount = Number(v.amount.replace(/[,\s$]/g, ""));
  if (!v.amount.trim()) errors.amount = "Enter the amount actually received.";
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount above 0.";
  else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) errors.amount = "Use at most 2 decimal places.";
  else {
    // The booking total can't be exceeded (the database checks this too).
    const { total, paid } = bookingMoney(b);
    if (paid - original.amount + amount > total + 0.005)
      errors.amount = `That would be more than the booking total (${total.toFixed(2)}).`;
  }
  if (!v.date) errors.date = "Enter the date the money arrived.";
  else if (v.date > today) errors.date = "The payment date can't be in the future.";
  else if (v.date < b.created) errors.date = "That's before the booking was created.";
  if (v.reference.length > 60) errors.reference = "Keep the reference under 60 characters.";
  if (v.note.length > 120) errors.note = "Keep the note under 120 characters.";
  const reason = v.reason.trim();
  if (reason.length < 5) errors.reason = "Explain why the payment is being corrected (at least 5 characters).";
  else if (reason.length > 200) errors.reason = "Keep the reason under 200 characters.";
  return errors;
}
