"use server";

// Invoice changes. Server Actions are public endpoints: every input is re-checked here
// (src/lib/invoice-rules.ts) and the database functions from migration 17 check the role
// again (finance / admin), number invoices at issue, freeze them and log every change.
import { refresh } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { bookingDates } from "@/lib/booking-rules";
import { validateCreateInvoice, validateIssueInvoice, validateVoidReason } from "@/lib/invoice-rules";

export type InvoiceActionResult = { ok: true; invoiceId: string; message?: string } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const today = () => new Date().toISOString().slice(0, 10);
const obj = (raw: unknown) => (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
const str = (r: Record<string, unknown>, k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");

async function financeContext() {
  const user = await getCurrentUser();
  const role = user.membership?.role;
  if (!user.membership) return { message: "Your login isn't linked to an agency yet. Ask your admin." } as const;
  if (role !== "admin" && role !== "finance_manager") return { message: "Only Finance or an admin can change invoices." } as const;
  return { supabase: await createClient(), orgId: user.membership.organizationId, role } as const;
}

/** Draft invoice from a booking (lines, discount and tax come from the booking; optional service fee). */
export async function createInvoice(bookingDbId: unknown, raw: unknown): Promise<InvoiceActionResult> {
  if (!isId(bookingDbId)) return { ok: false, message: "That booking couldn't be found." };
  const ctx = await financeContext();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const r = obj(raw);
  const v = { serviceFee: str(r, "serviceFee"), dueOn: str(r, "dueOn"), notes: str(r, "notes") };
  const problem = Object.values(validateCreateInvoice(v, today()))[0];
  if (problem) return { ok: false, message: problem };

  const { data, error } = await ctx.supabase.rpc("create_invoice", {
    p_booking_id: bookingDbId,
    p_service_fee: v.serviceFee.trim() ? Number(v.serviceFee.replace(/[,\s$]/g, "")) : 0,
    p_due_on: v.dueOn || null,
    p_notes: v.notes,
  });
  if (error) return { ok: false, message: friendly(error, "create this invoice") };
  refresh();
  return { ok: true, invoiceId: data as string };
}

/**
 * Accepted quotation → invoice. Uses the quotation's booking, creating it first when needed
 * (admins only — Finance can't create bookings). Returns the existing active invoice if there is one.
 */
export async function invoiceFromQuote(quoteDbId: unknown): Promise<InvoiceActionResult> {
  if (!isId(quoteDbId)) return { ok: false, message: "That quotation couldn't be found." };
  const ctx = await financeContext();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const { supabase, orgId, role } = ctx;

  const { data: quote } = await supabase
    .from("quotations")
    .select("id, status, customer_id, lead_id, depart_on, return_on")
    .eq("id", quoteDbId)
    .maybeSingle();
  if (!quote) return { ok: false, message: "That quotation couldn't be found." };
  if (quote.status !== "Accepted") return { ok: false, message: "Only accepted quotations can be invoiced." };

  let { data: booking } = await supabase.from("bookings").select("id").eq("quotation_id", quote.id).maybeSingle();
  if (!booking) {
    if (role !== "admin") return { ok: false, message: "This quotation isn't booked yet. Ask sales or ticketing to create the booking, then invoice it." };
    let customerId = quote.customer_id as string | null;
    if (!customerId && quote.lead_id) {
      const { data: lead } = await supabase.from("leads").select("customer_id").eq("id", quote.lead_id).maybeSingle();
      customerId = (lead?.customer_id as string | null) ?? null;
    }
    if (!customerId) return { ok: false, message: "This quotation is for a lead. Convert the lead to a customer first, then create the booking." };
    const d = bookingDates({ departDate: quote.depart_on ?? undefined, returnDate: quote.return_on ?? undefined }, today());
    const { data: bookingId, error } = await supabase.rpc("create_booking_from_quotation", {
      p_quotation_id: quote.id,
      p_customer_id: customerId,
      p_depart_on: d.departOn,
      p_return_on: d.returnOn ?? null,
      p_deposit_due_on: d.depositDue,
      p_balance_due_on: d.balanceDue,
    });
    if (error) return { ok: false, message: friendly(error, "create the booking") };
    booking = { id: bookingId as string };
  }

  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("organization_id", orgId)
    .eq("booking_id", booking.id)
    .neq("status", "Void")
    .maybeSingle();
  if (existing) return { ok: true, invoiceId: existing.id as string, message: "This booking already has an invoice — opening it." };

  return createInvoice(booking.id, { serviceFee: "", dueOn: "", notes: "" });
}

/** Rebuilds a draft from its booking (e.g. after a service changed). */
export async function refreshInvoiceDraft(invoiceId: unknown): Promise<InvoiceActionResult> {
  if (!isId(invoiceId)) return { ok: false, message: "That invoice couldn't be found." };
  const ctx = await financeContext();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const { error } = await ctx.supabase.rpc("refresh_invoice_draft", { p_invoice_id: invoiceId });
  if (error) return { ok: false, message: friendly(error, "refresh this draft") };
  refresh();
  return { ok: true, invoiceId };
}

/** Draft only: due date and the note printed on the invoice. */
export async function updateInvoiceDraft(invoiceId: unknown, raw: unknown): Promise<InvoiceActionResult> {
  if (!isId(invoiceId)) return { ok: false, message: "That invoice couldn't be found." };
  const ctx = await financeContext();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const r = obj(raw);
  const v = { serviceFee: "", dueOn: str(r, "dueOn"), notes: str(r, "notes") };
  const problem = Object.values(validateCreateInvoice(v, today()))[0];
  if (problem) return { ok: false, message: problem };
  const { data, error } = await ctx.supabase
    .from("invoices")
    .update({ due_on: v.dueOn || null, notes: v.notes.trim() || null })
    .eq("id", invoiceId)
    .eq("status", "Draft")
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: friendly(error, "change this draft") };
  refresh();
  return { ok: true, invoiceId };
}

/** Gives the invoice its number and freezes it (bill-to and passenger snapshot, payments linked). */
export async function issueInvoice(invoiceId: unknown, raw: unknown, bookingCreated: unknown): Promise<InvoiceActionResult> {
  if (!isId(invoiceId)) return { ok: false, message: "That invoice couldn't be found." };
  const ctx = await financeContext();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const r = obj(raw);
  const v = { issueOn: str(r, "issueOn"), dueOn: str(r, "dueOn") };
  const created = typeof bookingCreated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bookingCreated) ? bookingCreated : "1900-01-01";
  const problem = Object.values(validateIssueInvoice(v, today(), created))[0];
  if (problem) return { ok: false, message: problem };
  const { data, error } = await ctx.supabase.rpc("issue_invoice", { p_invoice_id: invoiceId, p_issue_on: v.issueOn, p_due_on: v.dueOn });
  if (error) return { ok: false, message: friendly(error, "issue this invoice") };
  refresh();
  return { ok: true, invoiceId, message: `Invoice ${data as string} issued.` };
}

export async function voidInvoice(invoiceId: unknown, reason: unknown): Promise<InvoiceActionResult> {
  if (!isId(invoiceId)) return { ok: false, message: "That invoice couldn't be found." };
  const why = typeof reason === "string" ? reason : "";
  const problem = validateVoidReason(why);
  if (problem) return { ok: false, message: problem };
  const ctx = await financeContext();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const { error } = await ctx.supabase.rpc("void_invoice", { p_invoice_id: invoiceId, p_reason: why.trim() });
  if (error) return { ok: false, message: friendly(error, "void this invoice") };
  refresh();
  return { ok: true, invoiceId };
}

/** Database errors as plain sentences. Messages raised by our own database functions are already written for people. */
function friendly(error: PostgrestError | null, action: string) {
  if (!error || error.code === "PGRST116" || /row-level security|permission denied/i.test(error.message)) {
    return `You don't have permission to ${action}.`;
  }
  if (["P0001", "P0002", "22023", "42501"].includes(error.code ?? "")) return error.message;
  if (error.code === "23505") return "This booking already has an invoice. Void it first to issue a new one.";
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007") {
    return "Some details weren't accepted. Check the dates and amounts and try again.";
  }
  return `Couldn't ${action}. Try again in a moment.`;
}
