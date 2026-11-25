"use server";

// Refund requests: request → approve → pay, or reject / withdraw (migration 18).
// Server Actions are public endpoints: inputs are re-checked here (src/lib/refund-rules.ts) against
// the booking as the database has it; the database functions check the role, the amounts and
// separation of duties again, and write every step to the audit log and the booking's timeline.
import { refresh } from "next/cache";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Booking, PaymentMethod, RefundCategory, RefundRequest } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { loadBooking } from "@/lib/data/bookings";
import { PAYMENT_METHODS, refundableAmount } from "@/lib/booking-rules";
import { REFUND_CATEGORIES, validateApprove, validatePay, validateReason, validateRefundRequest } from "@/lib/refund-rules";

export type RefundResult = { ok: true; booking: Booking } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const obj = (raw: unknown) => (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
const str = (r: Record<string, unknown>, k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
const method = (v: unknown): PaymentMethod => (PAYMENT_METHODS.includes(v as PaymentMethod) ? (v as PaymentMethod) : "Bank transfer");
const category = (v: unknown): RefundCategory | "" => (REFUND_CATEGORIES.includes(v as RefundCategory) ? (v as RefundCategory) : "");
const amountOf = (s: string) => Math.round(Number(s.replace(/[,\s$]/g, "")) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const first = (e: Record<string, string | undefined>) => Object.values(e).find(Boolean);

type Ctx = { supabase: SupabaseClient; booking: Booking; refund?: RefundRequest };

/** Loads the booking (and the refund, when given) as this user may see them. */
async function context(bookingDbId: unknown, refundId?: unknown): Promise<Ctx | { message: string }> {
  if (!isId(bookingDbId)) return { message: "That booking couldn't be found." };
  if (refundId !== undefined && !isId(refundId)) return { message: "That refund couldn't be found." };
  const supabase = await createClient();
  const booking = await loadBooking(supabase, bookingDbId);
  if (!booking) return { message: "This booking no longer exists, or you can't see it." };
  if (refundId === undefined) return { supabase, booking };
  const refund = booking.refundRequests?.find((r) => r.dbId === refundId);
  if (!refund) return { message: "That refund couldn't be found on this booking." };
  return { supabase, booking, refund };
}

async function done(supabase: SupabaseClient, bookingDbId: string, error: PostgrestError | null, action: string): Promise<RefundResult> {
  if (error) return { ok: false, message: friendly(error, action) };
  const booking = await loadBooking(supabase, bookingDbId);
  refresh();
  return booking ? { ok: true, booking } : { ok: false, message: "Saved. Reload the page to see the change." };
}

/** Ask Finance to refund the customer (cancelled bookings only). */
export async function requestRefund(bookingDbId: unknown, raw: unknown): Promise<RefundResult> {
  const ctx = await context(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const r = obj(raw);
  const v = { amount: str(r, "amount"), method: method(r.method), category: category(r.category), details: str(r, "details"), ticketId: str(r, "ticketId") };
  const problem = first(validateRefundRequest(v, refundableAmount(ctx.booking)));
  if (problem) return { ok: false, message: problem };
  if (v.ticketId && !isId(v.ticketId)) return { ok: false, message: "Choose the ticket again." };

  const { error } = await ctx.supabase.rpc("request_refund", {
    p_booking_id: ctx.booking.dbId,
    p_amount: amountOf(v.amount),
    p_method: v.method,
    p_category: v.category,
    p_details: v.details.trim(),
    p_ticket_id: v.ticketId || null,
  });
  return done(ctx.supabase, ctx.booking.dbId!, error, "request this refund");
}

/** Finance / admin: approve the requested amount or less (a note is needed for less). */
export async function approveRefund(bookingDbId: unknown, refundId: unknown, raw: unknown): Promise<RefundResult> {
  const ctx = await context(bookingDbId, refundId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const r = obj(raw);
  const v = { amount: str(r, "amount"), note: str(r, "note") };
  const problem = first(validateApprove(v, ctx.refund!.requestedAmount));
  if (problem) return { ok: false, message: problem };
  const { error } = await ctx.supabase.rpc("approve_refund", { p_refund_id: ctx.refund!.dbId, p_amount: amountOf(v.amount), p_note: v.note.trim() || null });
  return done(ctx.supabase, ctx.booking.dbId!, error, "approve this refund");
}

export async function rejectRefund(bookingDbId: unknown, refundId: unknown, reason: unknown): Promise<RefundResult> {
  const ctx = await context(bookingDbId, refundId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const why = typeof reason === "string" ? reason : "";
  const problem = validateReason(why);
  if (problem) return { ok: false, message: problem };
  const { error } = await ctx.supabase.rpc("reject_refund", { p_refund_id: ctx.refund!.dbId, p_reason: why.trim() });
  return done(ctx.supabase, ctx.booking.dbId!, error, "reject this refund");
}

/** The requester takes back a request Finance hasn't decided yet. */
export async function withdrawRefund(bookingDbId: unknown, refundId: unknown): Promise<RefundResult> {
  const ctx = await context(bookingDbId, refundId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { error } = await ctx.supabase.rpc("withdraw_refund", { p_refund_id: ctx.refund!.dbId });
  return done(ctx.supabase, ctx.booking.dbId!, error, "withdraw this request");
}

/** Finance / admin: the approved refund has been sent to the customer. */
export async function payRefund(bookingDbId: unknown, refundId: unknown, raw: unknown): Promise<RefundResult> {
  const ctx = await context(bookingDbId, refundId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const r = obj(raw);
  const v = { paidOn: str(r, "paidOn"), method: method(r.method), reference: str(r, "reference") };
  const problem = first(validatePay(v, today(), ctx.booking.created));
  if (problem) return { ok: false, message: problem };
  const { error } = await ctx.supabase.rpc("pay_refund", {
    p_refund_id: ctx.refund!.dbId,
    p_paid_on: v.paidOn,
    p_method: v.method,
    p_reference: v.reference.trim() || null,
  });
  return done(ctx.supabase, ctx.booking.dbId!, error, "mark this refund paid");
}

/** Finance / admin: a refund already sent, recorded in one step (marked "recorded directly" in the history). */
export async function recordPaidRefund(bookingDbId: unknown, raw: unknown): Promise<RefundResult> {
  const ctx = await context(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const r = obj(raw);
  const v = { amount: str(r, "amount"), method: method(r.method), category: category(r.category), details: str(r, "details"), ticketId: "" };
  const pay = { paidOn: str(r, "paidOn"), method: v.method, reference: str(r, "reference") };
  const problem = first(validateRefundRequest(v, refundableAmount(ctx.booking))) ?? first(validatePay(pay, today(), ctx.booking.created));
  if (problem) return { ok: false, message: problem };

  const { error } = await ctx.supabase.rpc("record_paid_refund", {
    p_booking_id: ctx.booking.dbId,
    p_amount: amountOf(v.amount),
    p_method: v.method,
    p_paid_on: pay.paidOn,
    p_category: v.category,
    p_details: v.details.trim(),
    p_reference: pay.reference.trim() || null,
  });
  return done(ctx.supabase, ctx.booking.dbId!, error, "record this refund");
}

/** Database errors as plain sentences. Messages raised by our own database functions are already written for people. */
function friendly(error: PostgrestError, action: string) {
  if (/exceed the amount received/i.test(error.message)) return "That's more than can still be refunded on this booking.";
  if (error.code === "PGRST116" || /row-level security|permission denied for/i.test(error.message)) return `You don't have permission to ${action}.`;
  if (["P0001", "P0002", "22023", "42501"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007") {
    return "Some details weren't accepted. Check the amount, date and reference and try again.";
  }
  return `Couldn't ${action}. Try again in a moment.`;
}
