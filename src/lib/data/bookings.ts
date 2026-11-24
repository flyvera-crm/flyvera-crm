// Bookings from Supabase (with services, timeline, payments, refunds and supplier
// payments), mapped into the app's existing `Booking` shape. Server-side only.
// Queries run as the signed-in user, so Row Level Security decides what each role sees:
// support agents see bookings but no prices or payments; sales see their customers' bookings.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Booking, BookingStatus, PaymentMethod, QuoteItemType } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";
import { agentName, getTeam, type Team } from "@/lib/data/team";

/** What the signed-in user may do with bookings (mirrors the RLS rules in migrations 10 and 15). */
export type BookingAccess = {
  canView: boolean;
  /** Prices, payments, refunds (everyone except support). */
  canSeeMoney: boolean;
  /** Create bookings from accepted quotations (admin, sales, ticketing — not finance or support). */
  canCreate: boolean;
  /** Move status forward / cancel (admin, ticketing, finance, sales in scope). */
  canEdit: boolean;
  /** Supplier references on services (admin, ticketing, sales in scope). */
  canEditServices: boolean;
  /** Record payments, refunds, "kept as fee", supplier payments, and correct payments (admin, finance). */
  canRecordMoney: boolean;
  /** See which suppliers have been paid (admin, finance, ticketing). */
  canSeeSuppliers: boolean;
};

// Named foreign keys, so the API never has to guess which link is meant.
export const BOOKING_COLUMNS =
  "id, code, customer_id, quotation_id, title, destination, depart_on, return_on, adults, children, discount, tax_rate, " +
  "status, deposit_due_on, balance_due_on, agent_id, cancel_reason, refund_decision, created_at, updated_at, " +
  "customer:customers!bookings_customer_id_organization_id_fkey(code, first_name, last_name, phone, email), " +
  "quotation:quotations!bookings_quotation_id_organization_id_fkey(code), " +
  "services:booking_services!booking_services_booking_id_organization_id_fkey(id, position, service_type, description, quantity, unit_price, cost, supplier_ref), " +
  "events:booking_events!booking_events_booking_id_organization_id_fkey(body, occurred_at), " +
  "payments:payments!payments_booking_id_organization_id_fkey(id, sequence_no, amount, method, received_on, note, reference, created_at, updated_at), " +
  "refunds:refunds!refunds_booking_id_organization_id_fkey(id, sequence_no, amount, method, status, paid_on, note), " +
  // For the "Issue tickets" step: who's travelling and who holds an issued ticket.
  "pax:passengers!passengers_booking_id_organization_id_fkey(id), " +
  "tix:tickets!tickets_booking_id_organization_id_fkey(passenger_id, status)";

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>) => (Array.isArray(v) ? (v[0] ?? null) : v);

export type BookingRow = {
  id: string;
  code: string;
  customer_id: string;
  quotation_id: string | null;
  title: string;
  destination: string;
  depart_on: string;
  return_on: string | null;
  adults: number;
  children: number;
  discount: number | string;
  tax_rate: number | string;
  status: BookingStatus;
  deposit_due_on: string;
  balance_due_on: string;
  agent_id: string | null;
  cancel_reason: string | null;
  refund_decision: "Refunded" | "Kept as fee" | null;
  created_at: string;
  updated_at: string;
  customer: One<{ code: string; first_name: string; last_name: string; phone: string; email: string | null }>;
  quotation: One<{ code: string }>;
  services: {
    id: string;
    position: number;
    service_type: QuoteItemType;
    description: string;
    quantity: number;
    unit_price: number | string;
    cost: number | string;
    supplier_ref: string | null;
  }[] | null;
  events: { body: string; occurred_at: string }[] | null;
  payments: {
    id: string;
    sequence_no: number;
    amount: number | string;
    method: PaymentMethod;
    received_on: string;
    note: string | null;
    reference: string | null;
    created_at: string;
    updated_at: string;
  }[] | null;
  refunds: {
    id: string;
    sequence_no: number;
    amount: number | string;
    method: PaymentMethod;
    status: "Requested" | "Approved" | "Paid" | "Rejected";
    paid_on: string | null;
    note: string | null;
  }[] | null;
  pax: { id: string }[] | null;
  tix: { passenger_id: string; status: string }[] | null;
};

export type SupplierTxRow = { booking_service_id: string | null; kind: "Payment" | "Refund" | "Credit note"; amount: number | string; occurred_on: string };

/** Per service: net amount paid to the supplier, and the date of the latest payment. */
export function supplierPaidByService(rows: SupplierTxRow[]) {
  const byService = new Map<string, { net: number; lastPaidOn?: string }>();
  for (const t of rows) {
    if (!t.booking_service_id) continue;
    const s = byService.get(t.booking_service_id) ?? { net: 0 };
    const amount = Number(t.amount);
    s.net = Math.round((s.net + (t.kind === "Payment" ? amount : -amount)) * 100) / 100;
    if (t.kind === "Payment" && (!s.lastPaidOn || t.occurred_on > s.lastPaidOn)) s.lastPaidOn = t.occurred_on;
    byService.set(t.booking_service_id, s);
  }
  return byService;
}

export function mapBooking(
  row: BookingRow,
  team: Team,
  supplier: Map<string, { net: number; lastPaidOn?: string }>,
  moneyHidden: boolean,
  ticketsVisible: boolean,
): Booking {
  const customer = one(row.customer);
  const services = [...(row.services ?? [])].sort((a, b) => a.position - b.position);
  const payments = (row.payments ?? []).map((p) => ({
    id: `p${p.sequence_no}`,
    dbId: p.id,
    date: p.received_on,
    amount: Number(p.amount),
    method: p.method,
    note: p.note ?? undefined,
    reference: p.reference ?? undefined,
    kind: "payment" as const,
    // updated_at moves on every correction (corrections are the only way to change a payment)
    corrected: Date.parse(p.updated_at) - Date.parse(p.created_at) > 1000,
  }));
  // Only refunds actually paid out count as money returned.
  const refunds = (row.refunds ?? [])
    .filter((r) => r.status === "Paid" && r.paid_on)
    .map((r) => ({
      id: `r${r.sequence_no}`,
      dbId: r.id,
      date: r.paid_on!,
      amount: Number(r.amount),
      method: r.method,
      note: r.note ?? undefined,
      kind: "refund" as const,
    }));

  return {
    id: row.code,
    dbId: row.id,
    customerId: customer?.code ?? "",
    customerName: customer ? `${customer.first_name} ${customer.last_name}` : "Customer",
    customerPhone: customer?.phone ?? "",
    customerEmail: customer?.email ?? undefined,
    quoteId: one(row.quotation)?.code,
    title: row.title,
    destination: row.destination,
    departDate: row.depart_on,
    returnDate: row.return_on ?? undefined,
    adults: row.adults,
    children: row.children,
    services: services.map((s, index) => {
      const cost = Number(s.cost);
      const paid = supplier.get(s.id);
      return {
        id: `s${index + 1}`,
        dbId: s.id,
        type: s.service_type,
        description: s.description,
        quantity: s.quantity,
        unitPrice: Number(s.unit_price),
        cost,
        ref: s.supplier_ref ?? undefined,
        supplierPaidOn: paid && cost > 0 && paid.net >= cost - 0.005 ? paid.lastPaidOn : undefined,
      };
    }),
    discount: Number(row.discount),
    taxRate: Number(row.tax_rate),
    status: row.status,
    payments: [...payments, ...refunds].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    depositDue: row.deposit_due_on,
    balanceDue: row.balance_due_on,
    agent: agentName(team, row.agent_id),
    agentId: row.agent_id ?? undefined,
    created: row.created_at.slice(0, 10),
    updated: row.updated_at.slice(0, 10),
    cancelReason: row.cancel_reason ?? undefined,
    refundSettled: row.refund_decision !== null,
    history: [...(row.events ?? [])]
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      .map((e) => ({ date: e.occurred_at.slice(0, 10), text: e.body })),
    moneyHidden,
    ticketing: {
      visible: ticketsVisible,
      passengers: (row.pax ?? []).length,
      ticketedPassengers: new Set((row.tix ?? []).filter((t) => t.status === "Issued").map((t) => t.passenger_id)).size,
    },
  };
}

const ALL_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent", "finance_manager", "support_agent"];
const MONEY_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent", "finance_manager"];
const CREATE_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent"];
const EDIT_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent", "finance_manager"];
const SERVICE_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent"];
const RECORD_MONEY_ROLES: AppRole[] = ["admin", "finance_manager"];
const SUPPLIER_ROLES: AppRole[] = ["admin", "finance_manager", "ticketing_agent"];
/** Roles that see both passengers and tickets (needed to complete the ticketing step). */
const TICKETING_VIEW_ROLES: AppRole[] = ["admin", "ticketing_agent", "sales_manager", "sales_agent"];
const ticketsVisible = (role: AppRole | undefined) => Boolean(role && TICKETING_VIEW_ROLES.includes(role));

export function bookingAccess(role: AppRole | undefined): BookingAccess {
  const has = (roles: AppRole[]) => Boolean(role && roles.includes(role));
  return {
    canView: has(ALL_ROLES),
    canSeeMoney: has(MONEY_ROLES),
    canCreate: has(CREATE_ROLES),
    canEdit: has(EDIT_ROLES),
    canEditServices: has(SERVICE_ROLES),
    canRecordMoney: has(RECORD_MONEY_ROLES),
    canSeeSuppliers: has(SUPPLIER_ROLES),
  };
}

/** Supplier payments for these bookings (only roles that may see them; others get none). */
async function supplierTransactions(supabase: SupabaseClient, access: BookingAccess, bookingIds?: string[]) {
  if (!access.canSeeSuppliers) return new Map<string, { net: number; lastPaidOn?: string }>();
  let query = supabase
    .from("supplier_transactions")
    .select("booking_service_id, kind, amount, occurred_on")
    .not("booking_service_id", "is", null);
  if (bookingIds) query = query.in("booking_id", bookingIds);
  const { data } = await query.overrideTypes<SupplierTxRow[], { merge: false }>();
  return supplierPaidByService(data ?? []);
}

/** One booking, freshly read (used by Server Actions to validate against the current state). */
export async function loadBooking(supabase: SupabaseClient, dbId: string): Promise<Booking | null> {
  const user = await getCurrentUser();
  const access = bookingAccess(user.membership?.role);
  const { data } = await supabase.from("bookings").select(BOOKING_COLUMNS).eq("id", dbId).maybeSingle<BookingRow>();
  if (!data) return null;
  const [team, supplier] = await Promise.all([getTeam(), supplierTransactions(supabase, access, [dbId])]);
  return mapBooking(data, team, supplier, !access.canSeeMoney, ticketsVisible(user.membership?.role));
}

/** All bookings the signed-in user may see, plus what they may do. Cached per request. */
export const getBookingData = cache(async (): Promise<{ bookings: Booking[]; access: BookingAccess }> => {
  const user = await getCurrentUser();
  const membership = user.membership;
  const access = bookingAccess(membership?.role);
  if (!membership || !access.canView) return { bookings: [], access };

  const supabase = await createClient();
  const [res, team, supplier] = await Promise.all([
    supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("organization_id", membership.organizationId)
      .order("created_at", { ascending: false })
      .limit(5000)
      .overrideTypes<BookingRow[], { merge: false }>(),
    getTeam(),
    supplierTransactions(supabase, access),
  ]);
  if (res.error) throw new Error(`Couldn't load bookings: ${res.error.message}`);

  const visible = ticketsVisible(membership.role);
  return { bookings: (res.data ?? []).map((row) => mapBooking(row, team, supplier, !access.canSeeMoney, visible)), access };
});
