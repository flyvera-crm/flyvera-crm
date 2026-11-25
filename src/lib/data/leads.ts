// Leads from Supabase, mapped into the app's existing `Lead` shape.
// Server-side only. Queries run as the signed-in user, so Row Level Security
// decides which leads each role sees (none for ticketing and finance).
import { cache } from "react";
import type { Lead, LeadPriority, LeadSource, LeadStage, TripType } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";
import { agentName, getTeam, type AgentOption, type Team } from "@/lib/data/team";

/** What the signed-in user may do with leads (mirrors the RLS rules in migration 10). */
export type LeadAccess = {
  /** Ticketing and finance don't work with leads at all. */
  canView: boolean;
  /** Admin, support and sales may add leads. */
  canCreate: boolean;
  /** Admin and sales may edit and move leads (support can only add and read). */
  canEdit: boolean;
  agentOptions: AgentOption[];
  defaultAgentId: string;
};

export const LEAD_COLUMNS =
  "id, code, full_name, phone, email, source, stage, priority, destination, trip_type, depart_on, return_on, " +
  "travellers, budget, assigned_to, next_follow_up_on, last_contacted_at, lost_reason, customer_id, notes, created_at, " +
  // Named foreign key, so the API never has to guess which customer link is meant.
  "customer:customers!leads_customer_id_organization_id_fkey(code)";

export type LeadRow = {
  id: string;
  code: string;
  full_name: string;
  phone: string;
  email: string | null;
  source: LeadSource;
  stage: LeadStage;
  priority: LeadPriority;
  destination: string;
  trip_type: TripType;
  depart_on: string | null;
  return_on: string | null;
  travellers: number;
  budget: number | string;
  assigned_to: string | null;
  next_follow_up_on: string | null;
  last_contacted_at: string | null;
  lost_reason: string | null;
  customer_id: string | null;
  notes: string | null;
  created_at: string;
  /** null when converted to a customer this user can't see. */
  customer: { code: string } | { code: string }[] | null;
};

const VIEW_ROLES: AppRole[] = ["admin", "support_agent", "sales_manager", "sales_agent"];
const EDIT_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent"];

export function mapLead(row: LeadRow, team: Team): Lead {
  const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
  return {
    id: row.code,
    dbId: row.id,
    name: row.full_name,
    phone: row.phone,
    email: row.email ?? undefined,
    source: row.source,
    stage: row.stage,
    priority: row.priority,
    destination: row.destination,
    tripType: row.trip_type,
    departDate: row.depart_on ?? undefined,
    returnDate: row.return_on ?? undefined,
    travellers: row.travellers,
    budget: Number(row.budget),
    agent: agentName(team, row.assigned_to),
    agentId: row.assigned_to ?? undefined,
    created: row.created_at.slice(0, 10),
    lastContact: (row.last_contacted_at ?? row.created_at).slice(0, 10),
    nextFollowUp: row.next_follow_up_on ?? undefined,
    notes: row.notes ?? undefined,
    lostReason: row.lost_reason ?? undefined,
    customerId: customer?.code ?? undefined,
  };
}

const NO_ACCESS: LeadAccess = { canView: false, canCreate: false, canEdit: false, agentOptions: [], defaultAgentId: "" };

/** All leads the signed-in user may see (archived ones excluded), plus what they may do. Cached per request. */
export const getLeadData = cache(async (): Promise<{ leads: Lead[]; access: LeadAccess }> => {
  const user = await getCurrentUser();
  const membership = user.membership;
  if (!membership || !VIEW_ROLES.includes(membership.role)) return { leads: [], access: NO_ACCESS };

  const supabase = await createClient();
  const [leadsRes, team] = await Promise.all([
    supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("organization_id", membership.organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5000)
      .overrideTypes<LeadRow[], { merge: false }>(),
    getTeam(),
  ]);
  if (leadsRes.error) throw new Error(`Couldn't load leads: ${leadsRes.error.message}`);

  const canEdit = EDIT_ROLES.includes(membership.role);
  return {
    leads: (leadsRes.data ?? []).map((row) => mapLead(row, team)),
    access: {
      canView: true,
      canCreate: true,
      canEdit,
      agentOptions: team.agentOptions,
      defaultAgentId: team.defaultAgentId,
    },
  };
});
