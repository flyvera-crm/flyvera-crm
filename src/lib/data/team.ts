// The signed-in user's agency team: display names, and who they may assign
// customers and leads to. Server-side only; cached per request.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";

export type AgentOption = { id: string; name: string };

export type Team = {
  /** Display name for every member (including disabled ones, for old records), by user id. */
  names: Map<string, string>;
  /**
   * People this user may assign records to. Same rule as the database's
   * private.in_sales_scope: sales agent → themselves; sales manager → themselves
   * and their teams; admin / support → any active admin or sales member.
   */
  agentOptions: AgentOption[];
  /** Pre-selected agent for new records ("" = choose). */
  defaultAgentId: string;
};

const ASSIGNABLE_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent"];
const UNNAMED = "Unnamed team member";

export const getTeam = cache(async (): Promise<Team> => {
  const user = await getCurrentUser();
  const membership = user.membership;
  if (!membership) return { names: new Map(), agentOptions: [], defaultAgentId: "" };

  const supabase = await createClient();
  const orgId = membership.organizationId;

  const { data: memberRows } = await supabase
    .from("organization_members")
    .select("user_id, role, status")
    .eq("organization_id", orgId);
  const members = (memberRows ?? []) as { user_id: string; role: AppRole; status: string }[];

  const ids = members.map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, display_name").in("id", ids)
    : { data: [] as { id: string; full_name: string; display_name: string | null }[] };

  const names = new Map<string, string>();
  for (const p of profiles ?? []) names.set(p.id, p.display_name?.trim() || p.full_name?.trim() || UNNAMED);
  // Profiles created from the dashboard often have no name yet: show the user's email for themselves.
  if (!names.get(user.id) || names.get(user.id) === UNNAMED) names.set(user.id, user.name);

  const candidates = members.filter((m) => m.status === "active" && ASSIGNABLE_ROLES.includes(m.role));
  let allowed: Set<string>;
  if (membership.role === "sales_agent") {
    allowed = new Set([user.id]);
  } else if (membership.role === "sales_manager") {
    const { data: teamRows } = await supabase
      .from("team_members")
      .select("team_id, user_id, is_manager")
      .eq("organization_id", orgId);
    const rows = (teamRows ?? []) as { team_id: string; user_id: string; is_manager: boolean }[];
    const managed = new Set(rows.filter((t) => t.user_id === user.id && t.is_manager).map((t) => t.team_id));
    allowed = new Set([user.id, ...rows.filter((t) => managed.has(t.team_id)).map((t) => t.user_id)]);
  } else if (membership.role === "admin" || membership.role === "support_agent") {
    allowed = new Set(candidates.map((m) => m.user_id));
  } else {
    allowed = new Set(); // ticketing, finance: never assign
  }

  const agentOptions = candidates
    .filter((m) => allowed.has(m.user_id))
    .map((m) => ({ id: m.user_id, name: names.get(m.user_id) ?? UNNAMED }))
    .sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.name.localeCompare(b.name)));

  return {
    names,
    agentOptions,
    defaultAgentId: agentOptions.some((a) => a.id === user.id) ? user.id : "",
  };
});

/** Name to show for an assignee id (or "Unassigned"). */
export function agentName(team: Team, userId: string | null | undefined) {
  if (!userId) return "Unassigned";
  return team.names.get(userId) ?? UNNAMED;
}
