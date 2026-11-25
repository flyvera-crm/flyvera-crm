// Pure refund-request rules (no React / browser APIs), shared by the screens and the Server Actions.
// The database functions from migration 18 enforce them again (roles, amounts, separation of duties).
import type { PaymentMethod, RefundCategory, RefundRequest } from "@/types/crm";

export const REFUND_CATEGORIES: RefundCategory[] = ["Cancellation", "Airline refund", "Schedule change", "Duplicate payment", "Other"];

const amountOf = (s: string) => Number(s.replace(/[,\s$]/g, ""));
const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Pending = still holding money back (counts against what was received). */
export const isPending = (r: RefundRequest) => r.status === "Requested" || r.status === "Approved";

export type RefundRequestValues = { amount: string; method: PaymentMethod; category: RefundCategory | ""; details: string; ticketId: string };

/** `available` = money received minus refunds already paid or pending. */
export function validateRefundRequest(v: RefundRequestValues, available: number) {
  const e: Partial<Record<keyof RefundRequestValues, string>> = {};
  const amount = amountOf(v.amount);
  if (!v.amount.trim()) e.amount = "Enter the amount to refund.";
  else if (!Number.isFinite(amount) || amount <= 0) e.amount = "Enter an amount above 0.";
  else if (!twoDecimals(amount)) e.amount = "Use at most 2 decimal places.";
  else if (amount > available + 0.005) e.amount = `At most ${available.toFixed(2)} can still be refunded.`;
  if (!v.category) e.category = "Choose a reason.";
  const d = v.details.trim();
  if (d.length < 5) e.details = "Explain the refund (at least 5 characters).";
  else if (d.length > 200) e.details = "Keep it under 200 characters.";
  return e;
}

export type ApproveValues = { amount: string; note: string };

export function validateApprove(v: ApproveValues, requested: number) {
  const e: Partial<Record<keyof ApproveValues, string>> = {};
  const amount = amountOf(v.amount);
  if (!v.amount.trim() || !Number.isFinite(amount) || amount <= 0) e.amount = "Enter an amount above 0.";
  else if (!twoDecimals(amount)) e.amount = "Use at most 2 decimal places.";
  else if (amount > requested + 0.005) e.amount = `You can approve ${requested.toFixed(2)} or less.`;
  else if (amount < requested - 0.005 && v.note.trim().length < 5) e.note = "Explain why less than requested is approved.";
  if (v.note.length > 200) e.note = "Keep the note under 200 characters.";
  return e;
}

export type PayValues = { paidOn: string; method: PaymentMethod; reference: string };

export function validatePay(v: PayValues, today: string, bookingCreated: string) {
  const e: Partial<Record<keyof PayValues, string>> = {};
  if (!DATE_RE.test(v.paidOn)) e.paidOn = "Enter the date the refund was sent.";
  else if (v.paidOn > today) e.paidOn = "The date can't be in the future.";
  else if (v.paidOn < bookingCreated) e.paidOn = "That's before the booking was created.";
  if (v.reference.length > 60) e.reference = "Keep the reference under 60 characters.";
  return e;
}

export function validateReason(reason: string) {
  const r = reason.trim();
  if (r.length < 5) return "Give a reason (at least 5 characters).";
  if (r.length > 200) return "Keep it under 200 characters.";
  return undefined;
}
