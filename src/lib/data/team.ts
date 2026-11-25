// The signed-in user's agency team: display names, and who they may assign
// customers and leads to. Server-side only; cached per request.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, ROLE_LABELS, type AppRole } from "@/lib/auth";
import type { Invitation, MemberEvent, MemberStatus, TeamGroup, TeamMember, TeamPageData } from "@/types/team";

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

/* ── The Team page ─────────────────────────────────────────────────────────── */

type DirectoryRow = {
  user_id: string;
  full_name: string | null;
  email: string;
  role: AppRole;
  status: MemberStatus;
  joined_at: string;
  last_sign_in_at: string | null;
};
type InvitationRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  team_id: string | null;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  last_sent_at: string | null;
  send_count: number;
  accepted_at: string | null;
  revoked_at: string | null;
};
type AuditRow = {
  created_at: string;
  actor_id: string | null;
  action: string;
  old_data: { role?: AppRole; status?: MemberStatus; user_id?: string } | null;
  new_data: { role?: AppRole; status?: MemberStatus; user_id?: string } | null;
  context: { reason?: string } | null;
};

/**
 * Everything the Team page shows. Admins get emails, last sign-in, invitations and each
 * member's access history; everyone else gets a read-only directory of active colleagues.
 */
export const getTeamPage = cache(async (): Promise<TeamPageData | null> => {
  const user = await getCurrentUser();
  const membership = user.membership;
  if (!membership) return null;
  const isAdmin = membership.role === "admin";
  const orgId = membership.organizationId;
  const supabase = await createClient();
  const team = await getTeam();

  const [{ data: teamRows }, { data: teamMemberRows }] = await Promise.all([
    supabase.from("teams").select("id, name").eq("organization_id", orgId).order("name"),
    supabase.from("team_members").select("team_id, user_id, is_manager").eq("organization_id", orgId),
  ]);
  const teamsById = new Map((teamRows ?? []).map((t) => [t.id as string, t.name as string]));
  const links = (teamMemberRows ?? []) as { team_id: string; user_id: string; is_manager: boolean }[];
  const teamsOf = (userId: string) =>
    links
      .filter((l) => l.user_id === userId && teamsById.has(l.team_id))
      .map((l) => ({ id: l.team_id, name: teamsById.get(l.team_id)!, isManager: l.is_manager }))
      .sort((a, b) => a.name.localeCompare(b.name));

  let members: TeamMember[];
  let invitations: Invitation[] = [];

  if (isAdmin) {
    const [{ data: directory }, { data: inviteRows }, { data: auditRows }] = await Promise.all([
      supabase.rpc("team_directory", { p_organization_id: orgId }),
      supabase
        .from("organization_invitations")
        .select("id, email, full_name, role, team_id, invited_by, created_at, expires_at, last_sent_at, send_count, accepted_at, revoked_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("audit_logs")
        .select("created_at, actor_id, action, old_data, new_data, context")
        .eq("organization_id", orgId)
        .eq("table_name", "organization_members")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    const history = new Map<string, MemberEvent[]>();
    for (const a of (auditRows ?? []) as AuditRow[]) {
      const userId = a.new_data?.user_id ?? a.old_data?.user_id;
      const text = describeChange(a);
      if (!userId || !text) continue;
      const by = a.actor_id ? agentName(team, a.actor_id) : "System";
      const list = history.get(userId) ?? [];
      list.push({ at: a.created_at, by, text, reason: a.context?.reason || undefined });
      history.set(userId, list);
    }
    members = ((directory ?? []) as DirectoryRow[]).map((r) => ({
      userId: r.user_id,
      name: r.full_name?.trim() || r.email,
      email: r.email,
      role: r.role,
      status: r.status,
      joinedOn: r.joined_at.slice(0, 10),
      lastSignInAt: r.last_sign_in_at,
      teams: teamsOf(r.user_id),
      history: history.get(r.user_id) ?? [],
    }));
    const now = new Date().toISOString();
    invitations = ((inviteRows ?? []) as InvitationRow[]).map((i) => ({
      id: i.id,
      email: i.email,
      fullName: i.full_name ?? "",
      role: i.role,
      teamName: i.team_id ? teamsById.get(i.team_id) : undefined,
      invitedBy: i.invited_by ? agentName(team, i.invited_by) : "—",
      createdOn: i.created_at.slice(0, 10),
      expiresAt: i.expires_at,
      lastSentAt: i.last_sent_at ?? undefined,
      sendCount: i.send_count,
      status: i.revoked_at ? "Revoked" : i.accepted_at ? "Accepted" : i.expires_at < now ? "Expired" : "Pending",
    }));
  } else {
    const { data: rows } = await supabase
      .from("organization_members")
      .select("user_id, role, status, created_at")
      .eq("organization_id", orgId)
      .eq("status", "active");
    members = ((rows ?? []) as { user_id: string; role: AppRole; status: MemberStatus; created_at: string }[]).map((r) => ({
      userId: r.user_id,
      name: agentName(team, r.user_id),
      role: r.role,
      status: r.status,
      joinedOn: r.created_at.slice(0, 10),
      teams: teamsOf(r.user_id),
    }));
  }

  members.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1));
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const teams: TeamGroup[] = [...teamsById].map(([id, name]) => ({
    id,
    name,
    members: links
      .filter((l) => l.team_id === id && names.has(l.user_id))
      .map((l) => ({ userId: l.user_id, name: names.get(l.user_id)!, isManager: l.is_manager }))
      .sort((a, b) => Number(b.isManager) - Number(a.isManager) || a.name.localeCompare(b.name)),
  }));

  return { me: user.id, isAdmin, members, invitations, teams };
});

function describeChange(a: AuditRow): string | null {
  const label = (r?: AppRole) => (r ? ROLE_LABELS[r] : "?");
  if (a.action === "INSERT") return `Joined as ${label(a.new_data?.role)}`;
  if (a.action === "DELETE") return "Removed from the agency";
  if (a.action !== "UPDATE") return null;
  const parts: string[] = [];
  if (a.old_data?.role !== a.new_data?.role) parts.push(`Role changed: ${label(a.old_data?.role)} → ${label(a.new_data?.role)}`);
  if (a.old_data?.status !== a.new_data?.status) parts.push(a.new_data?.status === "disabled" ? "Disabled" : "Re-enabled");
  return parts.length ? parts.join(" · ") : null;
}
