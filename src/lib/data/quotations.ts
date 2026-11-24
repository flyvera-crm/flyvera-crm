// Quotations (with their line items) from Supabase, mapped into the app's `Quotation` shape.
// Server-side only. Queries run as the signed-in user, so Row Level Security decides
// which quotations each role sees (none for support agents).
import { cache } from "react";
import type { QuoteItemType, QuoteStatus, Quotation } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";
import { agentName, getTeam, type AgentOption, type Team } from "@/lib/data/team";

/** What the signed-in user may do with quotations (mirrors the RLS rules in migration 10). */
export type QuoteAccess = {
  /** Support agents don't see quotations. */
  canView: boolean;
  /** Admin and sales may create, edit and change status; ticketing and finance only read. */
  canEdit: boolean;
  agentOptions: AgentOption[];
  defaultAgentId: string;
};

// Named foreign keys, so the API never has to guess which link is meant.
export const QUOTE_COLUMNS =
  "id, code, customer_id, lead_id, recipient, title, destination, depart_on, return_on, adults, children, " +
  "discount, tax_rate, valid_until, status, notes, prepared_by, sent_at, responded_at, created_at, updated_at, " +
  "customer:customers!quotations_customer_id_organization_id_fkey(code), " +
  "lead:leads!quotations_lead_id_organization_id_fkey(code), " +
  "items:quotation_items!quotation_items_quotation_id_organization_id_fkey(id, position, item_type, description, quantity, unit_price, cost)";

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>) => (Array.isArray(v) ? (v[0] ?? null) : v);

export type QuoteRow = {
  id: string;
  code: string;
  customer_id: string | null;
  lead_id: string | null;
  recipient: { kind?: string; code?: string; name?: string; email?: string | null; phone?: string };
  title: string;
  destination: string;
  depart_on: string | null;
  return_on: string | null;
  adults: number;
  children: number;
  discount: number | string;
  tax_rate: number | string;
  valid_until: string;
  status: QuoteStatus;
  notes: string | null;
  prepared_by: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  customer: One<{ code: string }>;
  lead: One<{ code: string }>;
  items: {
    id: string;
    position: number;
    item_type: QuoteItemType;
    description: string;
    quantity: number;
    unit_price: number | string;
    cost: number | string;
  }[] | null;
};

const VIEW_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent", "finance_manager"];
const EDIT_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent"];

export function mapQuote(row: QuoteRow, team: Team): Quotation {
  const kind = row.customer_id ? "customer" : "lead";
  const linkedCode = one(row.customer)?.code ?? one(row.lead)?.code;
  const items = [...(row.items ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: row.code,
    dbId: row.id,
    recipient: {
      kind,
      // The live link wins; the snapshot keeps the code if the record isn't visible to this user.
      id: linkedCode ?? row.recipient.code ?? "",
      name: row.recipient.name ?? "",
      email: row.recipient.email ?? undefined,
      phone: row.recipient.phone ?? "",
    },
    title: row.title,
    destination: row.destination,
    departDate: row.depart_on ?? undefined,
    returnDate: row.return_on ?? undefined,
    adults: row.adults,
    children: row.children,
    items: items.map((i, index) => ({
      id: `i${index + 1}`,
      dbId: i.id,
      type: i.item_type,
      description: i.description,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price),
      cost: Number(i.cost),
    })),
    discount: Number(row.discount),
    taxRate: Number(row.tax_rate),
    validUntil: row.valid_until,
    status: row.status,
    notes: row.notes ?? undefined,
    agent: agentName(team, row.prepared_by),
    agentId: row.prepared_by ?? undefined,
    created: row.created_at.slice(0, 10),
    updated: row.updated_at.slice(0, 10),
    sentAt: row.sent_at?.slice(0, 10),
    respondedAt: row.responded_at?.slice(0, 10),
  };
}

const NO_ACCESS: QuoteAccess = { canView: false, canEdit: false, agentOptions: [], defaultAgentId: "" };

/** All quotations the signed-in user may see (archived ones excluded), plus what they may do. Cached per request. */
export const getQuoteData = cache(async (): Promise<{ quotes: Quotation[]; access: QuoteAccess }> => {
  const user = await getCurrentUser();
  const membership = user.membership;
  if (!membership || !VIEW_ROLES.includes(membership.role)) return { quotes: [], access: NO_ACCESS };

  const supabase = await createClient();
  const [res, team] = await Promise.all([
    supabase
      .from("quotations")
      .select(QUOTE_COLUMNS)
      .eq("organization_id", membership.organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5000)
      .overrideTypes<QuoteRow[], { merge: false }>(),
    getTeam(),
  ]);
  if (res.error) throw new Error(`Couldn't load quotations: ${res.error.message}`);

  const canEdit = EDIT_ROLES.includes(membership.role);
  return {
    quotes: (res.data ?? []).map((row) => mapQuote(row, team)),
    access: {
      canView: true,
      canEdit,
      agentOptions: canEdit ? team.agentOptions : [],
      defaultAgentId: canEdit ? team.defaultAgentId : "",
    },
  };
});
