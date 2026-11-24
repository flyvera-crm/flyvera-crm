// Pure helpers that turn bookings into a payments ledger (no React / browser APIs).
import type { Booking, BookingPayment, BookingService } from "@/types/crm";
import { addDays } from "@/lib/customer-history";
import {
  bookingMoney,
  isRefund,
  paymentState,
  SUPPLIER_PAYABLE_STATUSES,
} from "@/lib/booking-rules";
import { BUILT_IN_DEFAULTS } from "@/lib/settings-rules";

export type LedgerEntry = { booking: Booking; payment: BookingPayment; receiptNo: string; signedAmount: number };

/** "FV-10481" + "p2" → "RC-10481-2" */
export function receiptNumber(bookingId: string, paymentId: string) {
  // Same format the database uses: RC-<booking>-<n> for payments, RF-<booking>-<n> for refunds ("r1", "r2"…).
  const prefix = paymentId.startsWith("r") ? "RF" : "RC";
  return `${prefix}-${bookingId.replace(/\D/g, "")}-${paymentId.replace(/\D/g, "")}`;
}

/** Every payment and refund across all bookings, newest first. Refunds count as negative. */
export function ledgerEntries(bookings: Booking[]): LedgerEntry[] {
  return bookings
    .flatMap((booking) =>
      booking.payments.map((payment) => ({
        booking,
        payment,
        receiptNo: receiptNumber(booking.id, payment.id),
        signedAmount: isRefund(payment) ? -payment.amount : payment.amount,
      })),
    )
    .sort((a, b) => b.payment.date.localeCompare(a.payment.date) || b.receiptNo.localeCompare(a.receiptNo));
}

/** Net money received per calendar month, oldest → newest, for the last `months` months up to `today`. */
export function monthlyNet(entries: LedgerEntry[], today: string, months = 6) {
  const [y, m] = today.split("-").map(Number);
  const keys = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (months - 1 - i), 1));
    return d.toISOString().slice(0, 7); // "2026-11"
  });
  return keys.map((key) => ({
    key,
    label: new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
    value: Math.round(entries.filter((e) => e.payment.date.startsWith(key)).reduce((s, e) => s + e.signedAmount, 0) * 100) / 100,
  }));
}

/** Balance still owed right after a given payment (payments counted in date order). */
export function balanceAfter(b: Booking, paymentId: string) {
  const { total } = bookingMoney(b);
  const ordered = [...b.payments].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
  let paid = 0;
  for (const p of ordered) {
    paid += isRefund(p) ? -p.amount : p.amount;
    if (p.id === paymentId) break;
  }
  return Math.round(Math.max(total - paid, 0) * 100) / 100;
}

/** Bookings with money still owed by the customer, most urgent first. */
export function customerDues(bookings: Booking[], today: string | null) {
  return bookings
    .filter((b) => b.status !== "Cancelled" && bookingMoney(b).balance > 0)
    .map((b) => {
      const { paid, balance } = bookingMoney(b);
      // Before any payment the deposit date matters; after, the balance date.
      const dueDate = paid === 0 && b.depositDue < b.balanceDue ? b.depositDue : b.balanceDue;
      return { booking: b, balance, dueDate, overdue: paymentState(b, today) === "Overdue" };
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate));
}

export type Payable = { booking: Booking; service: BookingService; dueDate: string };

/** Services the agency still has to pay suppliers for, soonest first. */
/** `daysBefore` = the agency's "pay suppliers this many days before departure" setting. */
export function supplierPayables(bookings: Booking[], daysBefore = BUILT_IN_DEFAULTS.supplierDaysBeforeDeparture): Payable[] {
  return bookings
    .filter((b) => SUPPLIER_PAYABLE_STATUSES.includes(b.status))
    .flatMap((booking) =>
      booking.services
        .filter((s) => s.cost > 0 && !s.supplierPaidOn)
        .map((service) => ({ booking, service, dueDate: addDays(booking.departDate, -daysBefore) })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Friendly WhatsApp/email reminder for an outstanding balance. */
export function reminderText(b: Booking, balance: number, dueDate: string, overdue: boolean, money: (n: number) => string, date: (d: string) => string) {
  const first = b.customerName.split(" ")[0];
  return (
    `Hi ${first}, a friendly reminder from FLYVERA about your ${b.title} booking (${b.id}). ` +
    `The remaining ${money(balance)} ${overdue ? "was" : "is"} due on ${date(dueDate)}. ` +
    `You can pay by card or bank transfer — just reply here if you have any questions. Thank you!`
  );
}
