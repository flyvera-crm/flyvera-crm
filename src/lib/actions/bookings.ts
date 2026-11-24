"use server";

// Every change to a booking and its money. Server Actions are public endpoints:
// each one re-reads the booking, re-checks the same business rules as the screen
// (src/lib/booking-rules.ts), writes as the signed-in user (Row Level Security has
// the final say) and adds a line to the booking's timeline.
import { refresh } from "next/cache";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Booking, BookingStatus, PaymentMethod } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { loadBooking } from "@/lib/data/bookings";
import {
  bookingDates,
  bookingMoney,
  CANCEL_REASONS,
  nextStep,
  PAYMENT_METHODS,
  refundState,
  STATUS_EVENT,
  validatePayment,
  validatePaymentCorrection,
} from "@/lib/booking-rules";
import { formatMoney } from "@/lib/format";

export type BookingResult = { ok: true; booking: Booking } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toISOString().slice(0, 10);
const amountOf = (s: string) => Math.round(Number(s.replace(/[,\s$]/g, "")) * 100) / 100;

/* ─────────────────────────── create ─────────────────────────── */

/** Accepted quotation → booking (booking + services + first timeline entry, all or nothing — migration 15). */
export async function createBookingFromQuote(quoteDbId: unknown, customerCode: unknown): Promise<BookingResult> {
  if (typeof quoteDbId !== "string" || !UUID_RE.test(quoteDbId)) return { ok: false, message: "That quotation couldn't be found." };
  if (typeof customerCode !== "string" || !/^CU-\d+$/.test(customerCode)) return { ok: false, message: "Choose the customer first." };
  const ctx = await context();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId } = ctx;

  const [{ data: quote }, { data: customer }] = await Promise.all([
    supabase.from("quotations").select("id, depart_on, return_on").eq("id", quoteDbId).maybeSingle(),
    supabase.from("customers").select("id").eq("organization_id", orgId).eq("code", customerCode).maybeSingle(),
  ]);
  if (!quote) return { ok: false, message: "That quotation couldn't be found." };
  if (!customer) return { ok: false, message: `Customer ${customerCode} wasn't found.` };

  const d = bookingDates({ departDate: quote.depart_on ?? undefined, returnDate: quote.return_on ?? undefined }, today());
  const { data: bookingId, error } = await supabase.rpc("create_booking_from_quotation", {
    p_quotation_id: quoteDbId,
    p_customer_id: customer.id,
    p_depart_on: d.departOn,
    p_return_on: d.returnOn ?? null,
    p_deposit_due_on: d.depositDue,
    p_balance_due_on: d.balanceDue,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "This quotation has already been booked." };
    return { ok: false, message: friendly(error, "create this booking") };
  }
  return done(supabase, bookingId as string);
}

/* ─────────────────────────── status ─────────────────────────── */

/** Moves the booking to its next status, if nothing blocks it (same rules as the screen). */
export async function advanceBooking(bookingDbId: unknown): Promise<BookingResult> {
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;

  const step = nextStep(booking, today());
  if (!step) return { ok: false, message: `A ${booking.status.toLowerCase()} booking has no next step.` };
  if (step.blocker) return { ok: false, message: `${step.action}: ${step.blocker}` };

  return update(supabase, orgId, booking, { status: step.next }, STATUS_EVENT[step.next]);
}

export async function cancelBooking(bookingDbId: unknown, reason: unknown): Promise<BookingResult> {
  if (typeof reason !== "string" || !CANCEL_REASONS.includes(reason)) return { ok: false, message: "Choose a cancellation reason." };
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  if (booking.status === "Cancelled" || booking.status === "Completed")
    return { ok: false, message: `A ${booking.status.toLowerCase()} booking can't be cancelled.` };

  return update(
    supabase,
    orgId,
    booking,
    { status: "Cancelled" satisfies BookingStatus, cancelled_at: new Date().toISOString(), cancel_reason: reason },
    `Booking cancelled — ${reason}`,
  );
}

/** Airline PNR / hotel confirmation number for one service (empty clears it). */
export async function setServiceRef(bookingDbId: unknown, serviceDbId: unknown, ref: unknown): Promise<BookingResult> {
  if (typeof serviceDbId !== "string" || !UUID_RE.test(serviceDbId) || typeof ref !== "string")
    return { ok: false, message: "That service couldn't be found." };
  const clean = ref.trim().toUpperCase();
  if (clean && !/^[A-Z0-9-]{2,40}$/.test(clean))
    return { ok: false, message: "References are 2–40 letters, digits or dashes (e.g. EK7Q2M)." };
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  if (booking.status === "Cancelled" || booking.status === "Completed")
    return { ok: false, message: "References can't be changed on a closed booking." };
  const service = booking.services.find((s) => s.dbId === serviceDbId);
  if (!service) return { ok: false, message: "That service isn't on this booking." };
  if ((service.ref ?? "") === clean) return { ok: true, booking };

  const { data, error } = await supabase
    .from("booking_services")
    .update({ supplier_ref: clean || null })
    .eq("id", serviceDbId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: friendly(error, "change this reference") };
  await addEvent(supabase, orgId, booking, clean ? `${service.type} confirmed — ref ${clean}` : `${service.type} reference removed`);
  return done(supabase, booking.dbId!);
}

/* ─────────────────────────── money (Finance / admin) ─────────────────────────── */

export async function recordPayment(bookingDbId: unknown, raw: unknown): Promise<BookingResult> {
  const v = paymentValues(raw);
  if (!v) return { ok: false, message: "The payment couldn't be read. Try again." };
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  if (booking.status === "Cancelled") return { ok: false, message: "Payments can't be added to a cancelled booking." };
  const errors = validatePayment(v, booking, today());
  const first = Object.values(errors)[0];
  if (first) return { ok: false, message: first };

  const amount = amountOf(v.amount);
  // Payments belong to the booking's issued invoice, when there is one (migration 17: one active per booking).
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id")
    .eq("booking_id", booking.dbId)
    .in("status", ["Issued", "Paid"])
    .maybeSingle();
  const { error } = await supabase.from("payments").insert({
    organization_id: orgId,
    booking_id: booking.dbId,
    invoice_id: invoice?.id ?? null,
    amount,
    method: v.method,
    received_on: v.date,
    note: v.note.trim() || null,
  });
  if (error) return { ok: false, message: friendly(error, "record this payment") };
  await addEvent(supabase, orgId, booking, `Payment of ${formatMoney(amount)} received (${v.method})`);
  return done(supabase, booking.dbId!);
}

/**
 * Corrects a recorded payment through the database function correct_payment()
 * (migration 15): Finance/admin only, reason required, before/after + reason go to
 * the audit log, and a "Payment … corrected" line is added to the booking's history.
 */
export async function correctPayment(bookingDbId: unknown, paymentDbId: unknown, raw: unknown): Promise<BookingResult> {
  if (typeof paymentDbId !== "string" || !UUID_RE.test(paymentDbId)) return { ok: false, message: "That payment couldn't be found." };
  const v = paymentValues(raw);
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!v || typeof r.reason !== "string" || typeof r.reference !== "string")
    return { ok: false, message: "The correction couldn't be read. Try again." };
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, booking } = ctx;
  const original = booking.payments.find((p) => p.dbId === paymentDbId && p.kind !== "refund");
  if (!original) return { ok: false, message: "That payment isn't on this booking." };

  const values = { ...v, reference: r.reference, reason: r.reason };
  const errors = validatePaymentCorrection(values, original, booking, today());
  const first = Object.values(errors)[0];
  if (first) return { ok: false, message: first };

  const { error } = await supabase.rpc("correct_payment", {
    p_payment_id: paymentDbId,
    p_amount: amountOf(v.amount),
    p_received_on: v.date,
    p_method: v.method,
    p_reference: values.reference,
    p_note: v.note,
    p_reason: values.reason.trim(),
  });
  if (error) return { ok: false, message: friendly(error, "correct this payment") };
  return done(supabase, booking.dbId!);
}

// Refunds (request / approve / pay / record directly) live in src/lib/actions/refunds.ts (migration 18).

/** Cancelled booking: keep what was paid as a cancellation fee. */
export async function keepAsFee(bookingDbId: unknown): Promise<BookingResult> {
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  if (!(await isFinance())) return { ok: false, message: "Only Finance or an admin can settle cancellations." };
  if (refundState(booking) !== "To settle") return { ok: false, message: "This booking has no refund to settle." };
  return update(
    supabase,
    orgId,
    booking,
    { refund_decision: "Kept as fee" },
    `No refund — ${formatMoney(bookingMoney(booking).paid)} kept as cancellation fee`,
  );
}

/**
 * Marks the agency's payment to the supplier for one service. Undo records a reversing
 * entry instead of deleting (money records are never deleted), so both stay visible.
 */
export async function markSupplierPaid(bookingDbId: unknown, serviceDbId: unknown, paid: unknown): Promise<BookingResult> {
  if (typeof serviceDbId !== "string" || !UUID_RE.test(serviceDbId) || typeof paid !== "boolean")
    return { ok: false, message: "That service couldn't be found." };
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  const service = booking.services.find((s) => s.dbId === serviceDbId);
  if (!service) return { ok: false, message: "That service isn't on this booking." };
  if (service.cost <= 0) return { ok: false, message: "This service has no supplier cost." };
  if (paid === Boolean(service.supplierPaidOn))
    return { ok: false, message: paid ? "This supplier is already marked as paid." : "This supplier isn't marked as paid." };

  const { error } = await supabase.from("supplier_transactions").insert({
    organization_id: orgId,
    booking_id: booking.dbId,
    booking_service_id: serviceDbId,
    kind: paid ? "Payment" : "Refund",
    amount: service.cost,
    method: "Bank transfer",
    occurred_on: today(),
    note: paid ? null : "Reverses an earlier supplier payment marked by mistake",
  });
  if (error) return { ok: false, message: friendly(error, "record this supplier payment") };
  await addEvent(
    supabase,
    orgId,
    booking,
    paid
      ? `Supplier paid for ${service.type.toLowerCase()} (${formatMoney(service.cost)})`
      : `Supplier payment for ${service.type.toLowerCase()} reversed`,
  );
  return done(supabase, booking.dbId!);
}

/* ─────────────────────────── helpers ─────────────────────────── */

async function context(): Promise<{ supabase: SupabaseClient; orgId: string } | { message: string }> {
  const user = await getCurrentUser();
  if (!user.membership) return { message: "Your login isn't linked to an agency yet. Ask your admin." };
  return { supabase: await createClient(), orgId: user.membership.organizationId };
}

async function withBooking(bookingDbId: unknown) {
  if (typeof bookingDbId !== "string" || !UUID_RE.test(bookingDbId)) return { message: "That booking couldn't be found." };
  const ctx = await context();
  if ("message" in ctx) return ctx;
  const booking = await loadBooking(ctx.supabase, bookingDbId);
  if (!booking) return { message: "This booking no longer exists, or you can't see it." };
  return { ...ctx, booking };
}

async function isFinance() {
  const role = (await getCurrentUser()).membership?.role;
  return role === "admin" || role === "finance_manager";
}

async function update(supabase: SupabaseClient, orgId: string, booking: Booking, patch: Record<string, unknown>, event: string): Promise<BookingResult> {
  const { data, error } = await supabase.from("bookings").update(patch).eq("id", booking.dbId!).select("id").maybeSingle();
  if (error || !data) return { ok: false, message: friendly(error, "change this booking") };
  await addEvent(supabase, orgId, booking, event);
  return done(supabase, booking.dbId!);
}

/** Timeline line (append-only). A failure here doesn't undo the change: the audit log has it too. */
async function addEvent(supabase: SupabaseClient, orgId: string, booking: Booking, text: string) {
  await supabase.from("booking_events").insert({ organization_id: orgId, booking_id: booking.dbId, body: text.slice(0, 300) });
}

async function done(supabase: SupabaseClient, bookingDbId: string): Promise<BookingResult> {
  const booking = await loadBooking(supabase, bookingDbId);
  refresh();
  return booking ? { ok: true, booking } : { ok: false, message: "Saved, but the booking couldn't be reloaded. Refresh the page." };
}

function paymentValues(raw: unknown) {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof r.amount !== "string" || typeof r.date !== "string" || typeof r.note !== "string") return null;
  if (!PAYMENT_METHODS.includes(r.method as PaymentMethod)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
  return { amount: r.amount, date: r.date, method: r.method as PaymentMethod, note: r.note };
}

/** Database errors as plain sentences. Messages raised by our own database functions are already written for people. */
function friendly(error: PostgrestError | null, action: string) {
  if (!error || error.code === "PGRST116" || /row-level security/i.test(error.message)) {
    return `You don't have permission to ${action}.`;
  }
  if (error.code === "42501" && /permission denied/i.test(error.message)) return `You don't have permission to ${action}.`;
  if (["P0001", "P0002", "22023", "42501"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007") {
    return "Some details weren't accepted. Check the amounts, dates and references and try again.";
  }
  return `Couldn't ${action}. Try again in a moment.`;
}
