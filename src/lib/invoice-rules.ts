// Pure invoice rules (no React / browser APIs), shared by the screens, the Server Actions and the PDF.
import type { Invoice, InvoiceStatus } from "@/types/invoices";

/**
 * Draft and Void are stored. Otherwise the status follows the money:
 * fully paid → Paid; past the due date → Overdue; some paid → Partially paid; else Unpaid.
 */
export function invoiceStatus(inv: Pick<Invoice, "storedStatus" | "total" | "paid" | "dueOn">, today: string | null): InvoiceStatus {
  if (inv.storedStatus === "Draft") return "Draft";
  if (inv.storedStatus === "Void") return "Void";
  if (inv.total <= 0 || inv.paid >= inv.total - 0.005) return "Paid";
  if (today && inv.dueOn && inv.dueOn < today) return "Overdue";
  return inv.paid > 0 ? "Partially paid" : "Unpaid";
}

export const balanceDue = (inv: Pick<Invoice, "total" | "paid" | "storedStatus">) =>
  inv.storedStatus === "Void" ? 0 : Math.max(Math.round((inv.total - inv.paid) * 100) / 100, 0);

export const INVOICE_STATUSES: InvoiceStatus[] = ["Draft", "Unpaid", "Partially paid", "Overdue", "Paid", "Void"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type CreateInvoiceValues = { serviceFee: string; dueOn: string; notes: string };

export function validateCreateInvoice(v: CreateInvoiceValues, today: string) {
  const e: Partial<Record<keyof CreateInvoiceValues, string>> = {};
  if (v.serviceFee.trim()) {
    const fee = Number(v.serviceFee.replace(/[,\s$]/g, ""));
    if (!Number.isFinite(fee) || fee < 0) e.serviceFee = "Enter an amount, e.g. 25.";
    else if (fee > 100_000) e.serviceFee = "That looks too high — please check the amount.";
    else if (Math.abs(fee * 100 - Math.round(fee * 100)) > 1e-6) e.serviceFee = "Use at most 2 decimal places.";
  }
  if (v.dueOn && (!DATE_RE.test(v.dueOn) || v.dueOn < today)) e.dueOn = "The due date can't be in the past.";
  if (v.notes.length > 600) e.notes = "Keep notes under 600 characters.";
  return e;
}

export type IssueInvoiceValues = { issueOn: string; dueOn: string };

export function validateIssueInvoice(v: IssueInvoiceValues, today: string, bookingCreated: string) {
  const e: Partial<Record<keyof IssueInvoiceValues, string>> = {};
  if (!DATE_RE.test(v.issueOn)) e.issueOn = "Enter the issue date.";
  else if (v.issueOn > today) e.issueOn = "The issue date can't be in the future.";
  else if (v.issueOn < bookingCreated) e.issueOn = "That's before the booking was created.";
  if (!DATE_RE.test(v.dueOn)) e.dueOn = "Enter the due date.";
  else if (DATE_RE.test(v.issueOn) && v.dueOn < v.issueOn) e.dueOn = "The due date must be on or after the issue date.";
  return e;
}

export function validateVoidReason(reason: string) {
  const r = reason.trim();
  if (r.length < 5) return "Explain why the invoice is being voided (at least 5 characters).";
  if (r.length > 200) return "Keep the reason under 200 characters.";
  return undefined;
}
