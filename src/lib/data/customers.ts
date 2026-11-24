// Customers from Supabase, mapped into the app's existing `Customer` shape.
// Server-side only. Every query runs as the signed-in user, so the database's
// Row Level Security decides which customers each role sees.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactMethod, Customer, CustomerStatus, CustomerTier, SeatPreference, StoredPassport } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";

export type AgentOption = { id: string; name: string };

/** What the signed-in user may do with customers (mirrors the RLS rules in migration 10). */
export type CustomerAccess = {
  canCreate: boolean;
  canEdit: boolean;
  /** May see and edit passport details (admin, sales, ticketing). */
  canSeePassports: boolean;
  /** People this user may assign a customer to. */
  agentOptions: AgentOption[];
  /** Pre-selected agent for new customers ("" = choose). */
  defaultAgentId: string;
};

export const CUSTOMER_COLUMNS =
  "id, code, first_name, last_name, email, phone, city, country, nationality, date_of_birth, tier, status, " +
  "preferred_contact, seat_preference, favourite_destination, whatsapp_opt_in, notes, assigned_to, created_at";

export type CustomerRow = {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
  city: string;
  country: string;
  nationality: string | null;
  date_of_birth: string | null;
  tier: CustomerTier;
  status: CustomerStatus;
  preferred_contact: ContactMethod;
  seat_preference: SeatPreference;
  favourite_destination: string | null;
  whatsapp_opt_in: boolean;
  notes: string | null;
  assigned_to: string | null;
  created_at: string;
};

type StatsRow = { customer_id: string; trip_count: number; lifetime_value: number | string; last_trip_on: string | null };
type PassportRow = { id: string; customer_id: string; number_last4: string; expiry_date: string; issuing_country: string };

const EDITOR_ROLES: AppRole[] = ["admin", "support_agent", "sales_manager", "sales_agent"];
const PASSPORT_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent"];
const STATS_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent", "finance_manager"];
const ASSIGNABLE_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent"];

export function mapCustomer(
  row: CustomerRow,
  extra: { agentName: string; stats?: StatsRow; passport?: PassportRow; statsHidden: boolean },
): Customer {
  const passport: StoredPassport | undefined = extra.passport && {
    documentId: extra.passport.id,
    last4: extra.passport.number_last4,
    expiry: extra.passport.expiry_date,
    issuingCountry: extra.passport.issuing_country,
  };
  return {
    id: row.code,
    dbId: row.id,
    name: `${row.first_name} ${row.last_name}`,
    email: row.email ?? "",
    phone: row.phone,
    city: row.city,
    country: row.country,
    tier: row.tier,
    status: row.status,
    trips: extra.stats?.trip_count ?? 0,
    lifetimeValue: Number(extra.stats?.lifetime_value ?? 0),
    lastTrip: extra.stats?.last_trip_on ?? null,
    favouriteDestination: row.favourite_destination ?? "",
    agent: extra.agentName,
    agentId: row.assigned_to ?? undefined,
    joined: row.created_at.slice(0, 10),
    dateOfBirth: row.date_of_birth ?? undefined,
    nationality: row.nationality ?? undefined,
    passport,
    passportExpiry: passport?.expiry,
    preferredContact: row.preferred_contact,
    seatPreference: row.seat_preference,
    whatsappOptIn: row.whatsapp_opt_in,
    notes: row.notes ?? undefined,
    statsHidden: extra.statsHidden,
  };
}

/** Display names of everyone in the organization, by user id. */
async function memberNames(supabase: SupabaseClient, organizationId: string, me: { id: string; name: string }) {
  const { data: members } = await supabase
    .from("organization_members")
    .select("user_id, role, status")
    .eq("organization_id", organizationId);
  const ids = (members ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, display_name").in("id", ids)
    : { data: [] as { id: string; full_name: string; display_name: string | null }[] };

  const names = new Map<string, string>();
  for (const p of profiles ?? []) {
    names.set(p.id, p.display_name?.trim() || p.full_name?.trim() || "Unnamed team member");
  }
  if (!names.get(me.id) || names.get(me.id) === "Unnamed team member") names.set(me.id, me.name);
  return { members: (members ?? []) as { user_id: string; role: AppRole; status: string }[], names };
}

/** Who this user may assign customers to (same rule as private.in_sales_scope). */
async function assignableAgents(
  supabase: SupabaseClient,
  organizationId: string,
  role: AppRole,
  myId: string,
  members: { user_id: string; role: AppRole; status: string }[],
  names: Map<string, string>,
): Promise<AgentOption[]> {
  const candidates = members.filter((m) => m.status === "active" && ASSIGNABLE_ROLES.includes(m.role));
  let allowed: string[];
  if (role === "sales_agent") {
    allowed = [myId];
  } else if (role === "sales_manager") {
    const { data: teams } = await supabase
      .from("team_members")
      .select("team_id, user_id, is_manager")
      .eq("organization_id", organizationId);
    const managed = new Set((teams ?? []).filter((t) => t.user_id === myId && t.is_manager).map((t) => t.team_id));
    allowed = [myId, ...(teams ?? []).filter((t) => managed.has(t.team_id)).map((t) => t.user_id as string)];
  } else {
    allowed = candidates.map((m) => m.user_id);
  }
  const allowedSet = new Set(allowed);
  return candidates
    .filter((m) => allowedSet.has(m.user_id))
    .map((m) => ({ id: m.user_id, name: names.get(m.user_id) ?? "Unnamed team member" }))
    .sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : a.name.localeCompare(b.name)));
}

const NO_ACCESS: CustomerAccess = {
  canCreate: false,
  canEdit: false,
  canSeePassports: false,
  agentOptions: [],
  defaultAgentId: "",
};

/** All customers the signed-in user may see (archived ones excluded), plus what they may do. Cached per request. */
export const getCustomerData = cache(async (): Promise<{ customers: Customer[]; access: CustomerAccess }> => {
  const user = await getCurrentUser();
  const membership = user.membership;
  if (!membership) return { customers: [], access: NO_ACCESS };

  const supabase = await createClient();
  const role = membership.role;

  const [customersRes, statsRes, passportsRes, team] = await Promise.all([
    supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("organization_id", membership.organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5000)
      .overrideTypes<CustomerRow[], { merge: false }>(),
    STATS_ROLES.includes(role)
      ? supabase.from("customer_stats").select("customer_id, trip_count, lifetime_value, last_trip_on").overrideTypes<StatsRow[], { merge: false }>()
      : Promise.resolve({ data: [] as StatsRow[], error: null }),
    PASSPORT_ROLES.includes(role)
      ? supabase
          .from("customer_travel_documents")
          .select("id, customer_id, number_last4, expiry_date, issuing_country")
          .eq("document_type", "Passport")
          .eq("is_primary", true)
          .overrideTypes<PassportRow[], { merge: false }>()
      : Promise.resolve({ data: [] as PassportRow[], error: null }),
    memberNames(supabase, membership.organizationId, user),
  ]);

  if (customersRes.error) throw new Error(`Couldn't load customers: ${customersRes.error.message}`);

  const stats = new Map((statsRes.data ?? []).map((s) => [s.customer_id, s]));
  const passports = new Map((passportsRes.data ?? []).map((p) => [p.customer_id, p]));
  const statsHidden = !STATS_ROLES.includes(role);

  const customers = (customersRes.data ?? []).map((row) =>
    mapCustomer(row, {
      agentName: row.assigned_to ? (team.names.get(row.assigned_to) ?? "Unnamed team member") : "Unassigned",
      stats: stats.get(row.id),
      passport: passports.get(row.id),
      statsHidden,
    }),
  );

  const canEdit = EDITOR_ROLES.includes(role);
  const agentOptions = canEdit
    ? await assignableAgents(supabase, membership.organizationId, role, user.id, team.members, team.names)
    : [];

  return {
    customers,
    access: {
      canCreate: canEdit,
      canEdit,
      canSeePassports: PASSPORT_ROLES.includes(role),
      agentOptions,
      defaultAgentId: agentOptions.some((a) => a.id === user.id) ? user.id : "",
    },
  };
});
