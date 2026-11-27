// Saved flight searches for the Flights page. Read as the signed-in user, so Row Level Security decides what
// each person sees (migration 10): admins and ticketing agents see the agency's searches, sales managers
// and agents those in their sales scope, other roles none. Linked leads / customers and the typed request
// are shown only if this person may read them too. Read-only: nothing here changes data.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";
import { savedSearchFromRow, type SavedSearch, type SearchRow } from "@/lib/saved-searches";

/** Same roles that may create flight searches and use the request panel. */
const VIEW: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent"];
export const SAVED_SEARCH_LIMIT = 50;

export const getSavedSearches = cache(async (): Promise<{ allowed: boolean; searches: SavedSearch[]; more: boolean }> => {
  const user = await getCurrentUser();
  const m = user.membership;
  if (!m || !VIEW.includes(m.role)) return { allowed: false, searches: [], more: false };
  const supabase = await createClient();

  const { data } = await supabase
    .from("flight_searches")
    .select("id, origin, destination, depart_on, return_on, adults, children, infants, cabin, request, searched_at, created_by, lead_id, customer_id")
    .eq("organization_id", m.organizationId)
    .order("searched_at", { ascending: false })
    .limit(SAVED_SEARCH_LIMIT + 1);
  const rows = ((data ?? []) as SearchRow[]).slice(0, SAVED_SEARCH_LIMIT);
  const more = (data ?? []).length > SAVED_SEARCH_LIMIT;
  if (!rows.length) return { allowed: true, searches: [], more: false };

  const unique = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const creatorIds = unique(rows.map((r) => r.created_by));
  const leadIds = unique(rows.map((r) => r.lead_id));
  const customerIds = unique(rows.map((r) => r.customer_id));
  const readingIds = unique(
    rows.map((r) => {
      const id = r.request && typeof r.request === "object" ? (r.request as Record<string, unknown>).ai_action_id : null;
      return typeof id === "string" ? id : null;
    }),
  );

  const none = { data: [] as never[] };
  const [profiles, leads, customers, readings] = await Promise.all([
    creatorIds.length ? supabase.from("profiles").select("id, full_name, display_name").in("id", creatorIds) : none,
    leadIds.length ? supabase.from("leads").select("id, code, full_name").eq("organization_id", m.organizationId).in("id", leadIds) : none,
    customerIds.length ? supabase.from("customers").select("id, code, first_name, last_name").eq("organization_id", m.organizationId).in("id", customerIds) : none,
    readingIds.length ? supabase.from("ai_actions").select("id, input").eq("organization_id", m.organizationId).eq("action_kind", "Flight request").in("id", readingIds) : none,
  ]);

  const names = new Map<string, string>();
  for (const p of (profiles.data ?? []) as { id: string; full_name: string | null; display_name: string | null }[]) {
    names.set(p.id, p.display_name?.trim() || p.full_name?.trim() || "Unnamed colleague");
  }
  if (!names.get(user.id) || names.get(user.id) === "Unnamed colleague") names.set(user.id, user.name);
  const leadById = new Map(((leads.data ?? []) as { id: string; code: string; full_name: string }[]).map((l) => [l.id, { code: l.code, name: l.full_name }]));
  const customerById = new Map(
    ((customers.data ?? []) as { id: string; code: string; first_name: string; last_name: string }[]).map((c) => [c.id, { code: c.code, name: `${c.first_name} ${c.last_name}`.trim() }]),
  );
  const typed = new Map<string, string>();
  for (const a of (readings.data ?? []) as { id: string; input: { text?: unknown } | null }[]) {
    if (typeof a.input?.text === "string") typed.set(a.id, a.input.text);
  }

  const searches = rows.map((row) =>
    savedSearchFromRow(row, {
      names,
      typed,
      lead: row.lead_id ? leadById.get(row.lead_id) ?? null : null,
      customer: row.customer_id ? customerById.get(row.customer_id) ?? null : null,
    }),
  );
  return { allowed: true, searches, more };
});
