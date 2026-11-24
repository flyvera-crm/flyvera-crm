// Invoices from Supabase (with lines, linked payments and the booking's refunds).
// Server-side only; loaded by the Invoices pages, booking pages and customer profiles.
// Queries run as the signed-in user, so Row Level Security decides who sees what.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillTo, Invoice, InvoiceAccess, InvoiceHistoryLine, InvoiceLineType, InvoicePassenger, InvoiceStoredStatus } from "@/types/invoices";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";

const VIEW_ROLES: AppRole[] = ["admin", "finance_manager", "ticketing_agent", "sales_manager", "sales_agent"];
const MANAGE_ROLES: AppRole[] = ["admin", "finance_manager"];

export function invoiceAccess(role: AppRole | undefined): InvoiceAccess {
  return { canView: Boolean(role && VIEW_ROLES.includes(role)), canManage: Boolean(role && MANAGE_ROLES.includes(role)) };
}

// Named foreign keys, so the API never has to guess which link is meant.
const INVOICE_COLUMNS =
  "id, number, booking_id, status, issue_on, due_on, currency, subtotal, discount, tax_rate, tax, total, notes, bill_to, passengers, " +
  "void_reason, voided_at, created_at, " +
  "booking:bookings!invoices_booking_id_organization_id_fkey(code, title), " +
  "customer:customers!invoices_customer_id_organization_id_fkey(code, first_name, last_name, email, phone, city, country), " +
  "lines:invoice_lines!invoice_lines_invoice_id_organization_id_fkey(id, position, item_type, description, quantity, unit_price, line_total), " +
  "payments:payments!payments_invoice_id_organization_id_fkey(sequence_no, amount, method, received_on)";

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>) => (Array.isArray(v) ? (v[0] ?? null) : v);
const n = (v: number | string | null | undefined) => Number(v ?? 0);

type InvoiceRow = {
  id: string;
  number: string | null;
  booking_id: string;
  status: InvoiceStoredStatus;
  issue_on: string | null;
  due_on: string | null;
  currency: string;
  subtotal: number | string;
  discount: number | string;
  tax_rate: number | string;
  tax: number | string;
  total: number | string;
  notes: string | null;
  bill_to: BillTo | null;
  passengers: InvoicePassenger[] | null;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  booking: One<{ code: string; title: string }>;
  customer: One<{ code: string; first_name: string; last_name: string; email: string | null; phone: string; city: string; country: string }>;
  lines: { id: string; position: number; item_type: InvoiceLineType; description: string; quantity: number | string; unit_price: number | string; line_total: number | string }[] | null;
  payments: { sequence_no: number; amount: number | string; method: string; received_on: string }[] | null;
};
type RefundRow = { booking_id: string; sequence_no: number; amount: number | string; method: string; paid_on: string };

function mapInvoice(row: InvoiceRow, refunds: RefundRow[]): Invoice {
  const booking = one(row.booking);
  const customer = one(row.customer);
  const linked = (row.payments ?? []).map((p) => ({
    id: `p${p.sequence_no}`,
    kind: "payment" as const,
    date: p.received_on,
    amount: n(p.amount),
    method: p.method,
  }));
  // The booking's paid refunds count against its active invoice (one active invoice per booking).
  const active = row.status !== "Draft" && row.status !== "Void";
  const backs = active
    ? refunds
        .filter((r) => r.booking_id === row.booking_id)
        .map((r) => ({ id: `r${r.sequence_no}`, kind: "refund" as const, date: r.paid_on, amount: n(r.amount), method: r.method }))
    : [];
  const payments = [...linked, ...backs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const paid = Math.round(payments.reduce((s, p) => s + (p.kind === "refund" ? -p.amount : p.amount), 0) * 100) / 100;

  return {
    id: row.id,
    number: row.number ?? undefined,
    storedStatus: row.status,
    bookingDbId: row.booking_id,
    bookingCode: booking?.code ?? "",
    bookingTitle: booking?.title ?? "",
    customerCode: row.bill_to?.code ?? customer?.code ?? "",
    billTo: row.bill_to ?? {
      code: customer?.code,
      name: customer ? `${customer.first_name} ${customer.last_name}` : "Customer",
      email: customer?.email,
      phone: customer?.phone,
      city: customer?.city,
      country: customer?.country,
    },
    passengers: row.passengers ?? [],
    issueOn: row.issue_on ?? undefined,
    dueOn: row.due_on ?? undefined,
    currency: row.currency,
    lines: [...(row.lines ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ id: l.id, type: l.item_type, description: l.description, quantity: n(l.quantity), unitPrice: n(l.unit_price), total: n(l.line_total) })),
    subtotal: n(row.subtotal),
    discount: n(row.discount),
    taxRate: n(row.tax_rate),
    tax: n(row.tax),
    total: n(row.total),
    notes: row.notes ?? undefined,
    voidReason: row.void_reason ?? undefined,
    voidedOn: row.voided_at?.slice(0, 10),
    created: row.created_at.slice(0, 10),
    payments,
    paid,
  };
}

async function loadInvoices(supabase: SupabaseClient, organizationId: string, filter?: { id?: string }) {
  let query = supabase.from("invoices").select(INVOICE_COLUMNS).eq("organization_id", organizationId);
  if (filter?.id) query = query.eq("id", filter.id);
  const [res, refunds] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(5000).overrideTypes<InvoiceRow[], { merge: false }>(),
    supabase
      .from("refunds")
      .select("booking_id, sequence_no, amount, method, paid_on")
      .eq("organization_id", organizationId)
      .eq("status", "Paid")
      .overrideTypes<RefundRow[], { merge: false }>(),
  ]);
  if (res.error) throw new Error(`Couldn't load invoices: ${res.error.message}`);
  return (res.data ?? []).map((row) => mapInvoice(row, refunds.data ?? []));
}

/** Every invoice this user may see, newest first. Cached per request. */
export const getInvoices = cache(async (): Promise<{ invoices: Invoice[]; access: InvoiceAccess }> => {
  const user = await getCurrentUser();
  const access = invoiceAccess(user.membership?.role);
  if (!user.membership || !access.canView) return { invoices: [], access };
  const supabase = await createClient();
  return { invoices: await loadInvoices(supabase, user.membership.organizationId), access };
});

/** One invoice with its history (timeline lines about invoices on its booking). */
export const getInvoice = cache(async (id: string) => {
  const user = await getCurrentUser();
  const access = invoiceAccess(user.membership?.role);
  if (!user.membership || !access.canView || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const [invoice] = await loadInvoices(supabase, user.membership.organizationId, { id });
  if (!invoice) return null;
  const { data: events } = await supabase
    .from("booking_events")
    .select("body, occurred_at")
    .eq("booking_id", invoice.bookingDbId)
    .or("body.ilike.invoice%,body.ilike.service fee%")
    .order("occurred_at");
  const history: InvoiceHistoryLine[] = (events ?? []).map((e) => ({ date: (e.occurred_at as string).slice(0, 10), text: e.body as string }));
  const { data: bookingRow } = await supabase.from("bookings").select("created_at").eq("id", invoice.bookingDbId).maybeSingle();
  return { invoice, history, access, bookingCreated: ((bookingRow?.created_at as string | undefined) ?? invoice.created).slice(0, 10) };
});
