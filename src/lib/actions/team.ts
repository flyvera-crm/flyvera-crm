"use server";

// Team & access (migration 19). Admins only — every action checks it here, and the database
// functions check it again, require reasons, protect the last admin and write the audit log.
// The service-role client (src/lib/supabase/admin.ts) is used only to send invitation emails and
// to remove the unaccepted login of a revoked invitation, after the admin check.
import { refresh } from "next/cache";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { OpenWork } from "@/types/team";
import { getCurrentUser } from "@/lib/auth";
import { ROLES, type AppRole } from "@/config/roles";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateInvite, validateReason, validateTeamName } from "@/lib/team-rules";

export type TeamResult = { ok: true; message?: string; warning?: string } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isRole = (v: unknown): v is AppRole => ROLES.includes(v as AppRole);
const text = (v: unknown) => (typeof v === "string" ? v : "");

type Ctx = { supabase: SupabaseClient; orgId: string; me: string };

async function adminContext(): Promise<Ctx | { message: string }> {
  const user = await getCurrentUser();
  if (user.membership?.role !== "admin") return { message: "Only an admin can manage the team." };
  return { supabase: await createClient(), orgId: user.membership.organizationId, me: user.id };
}

function done(error: PostgrestError | null, action: string, extra?: { message?: string; warning?: string }): TeamResult {
  if (error) return { ok: false, message: friendly(error, action) };
  refresh();
  return { ok: true, ...extra };
}

/* ── Invitations ── */

export async function inviteMember(raw: unknown): Promise<TeamResult> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const v = { email: text(r.email).trim().toLowerCase(), fullName: text(r.fullName).trim(), role: isRole(r.role) ? r.role : ("" as const), teamId: text(r.teamId) };
  const problem = Object.values(validateInvite(v)).find(Boolean);
  if (problem) return { ok: false, message: problem };
  if (v.teamId && !isId(v.teamId)) return { ok: false, message: "Choose the team again." };

  const { data, error } = await ctx.supabase.rpc("invite_member", {
    p_organization_id: ctx.orgId,
    p_email: v.email,
    p_full_name: v.fullName,
    p_role: v.role,
    p_team_id: v.teamId || null,
  });
  if (error) return done(error, "invite this person");
  const result = data as { id: string; granted: boolean };
  if (result.granted) {
    return done(null, "", { message: `${v.fullName} already had a FLYVERA login — they have access now and can sign in.` });
  }
  const sent = await sendInvitationEmail(ctx, result.id, v.email, v.fullName);
  return done(null, "", sent.ok ? { message: `Invitation sent to ${v.email}.` } : { warning: `Invitation saved, but ${sent.message}` });
}

export async function resendInvitation(invitationId: unknown): Promise<TeamResult> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  if (!isId(invitationId)) return { ok: false, message: "That invitation couldn't be found." };
  const { data: inv } = await ctx.supabase
    .from("organization_invitations")
    .select("id, email, full_name, accepted_at, revoked_at")
    .eq("id", invitationId)
    .maybeSingle();
  if (!inv) return { ok: false, message: "That invitation couldn't be found." };
  if (inv.accepted_at || inv.revoked_at) return { ok: false, message: "This invitation is no longer open." };
  const sent = await sendInvitationEmail(ctx, inv.id, inv.email, inv.full_name ?? "");
  if (!sent.ok) return { ok: false, message: sent.message };
  return done(null, "", { message: `Invitation sent again to ${inv.email}.` });
}

export async function revokeInvitation(invitationId: unknown): Promise<TeamResult> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  if (!isId(invitationId)) return { ok: false, message: "That invitation couldn't be found." };
  const { data: loginId, error } = await ctx.supabase.rpc("revoke_invitation", { p_invitation_id: invitationId });
  if (error) return done(error, "revoke this invitation");
  // The invited login was never confirmed: remove it so the email link stops working.
  // (Even if this fails, the revoked invitation grants no access.)
  if (typeof loginId === "string") await createAdminClient()?.auth.admin.deleteUser(loginId);
  return done(null, "", { message: "Invitation revoked." });
}

async function sendInvitationEmail(ctx: Ctx, invitationId: string, email: string, fullName: string) {
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false as const, message: "the email couldn't be sent: SUPABASE_SERVICE_ROLE_KEY isn't set on the server." };
  }
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName } });
  if (error) {
    if (error.status === 429) return { ok: false as const, message: "the email service is busy (rate limit). Try Resend in a few minutes." };
    if (/already been registered/i.test(error.message)) {
      return { ok: false as const, message: "this address already has a confirmed login — they can sign in, or use “Forgot password”." };
    }
    return { ok: false as const, message: "the email couldn't be sent. Try Resend in a moment." };
  }
  await ctx.supabase.rpc("mark_invitation_sent", { p_invitation_id: invitationId });
  return { ok: true as const };
}

/* ── Members ── */

export async function changeMemberRole(userId: unknown, role: unknown, reason: unknown): Promise<TeamResult> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  if (!isId(userId) || !isRole(role)) return { ok: false, message: "Choose the person and role again." };
  if (userId === ctx.me) return { ok: false, message: "You can't change your own role. Ask another admin." };
  const why = text(reason);
  const problem = validateReason(why);
  if (problem) return { ok: false, message: problem };
  const { error } = await ctx.supabase.rpc("change_member_role", {
    p_organization_id: ctx.orgId,
    p_user_id: userId,
    p_role: role,
    p_reason: why.trim(),
  });
  return done(error, "change this role", { message: "Role changed." });
}

/** What would move to a colleague if this person were disabled. */
export async function getOpenWork(userId: unknown): Promise<{ ok: true; work: OpenWork } | { ok: false; message: string }> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  if (!isId(userId)) return { ok: false, message: "That person couldn't be found." };
  const { data, error } = await ctx.supabase.rpc("member_open_work", { p_organization_id: ctx.orgId, p_user_id: userId });
  if (error) return { ok: false, message: friendly(error, "check their open work") };
  return { ok: true, work: data as OpenWork };
}

export async function setMemberStatus(userId: unknown, status: unknown, reason: unknown, reassignTo: unknown): Promise<TeamResult> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  if (!isId(userId) || (status !== "active" && status !== "disabled")) return { ok: false, message: "Choose the person again." };
  if (userId === ctx.me) return { ok: false, message: "You can't disable or re-enable yourself. Ask another admin." };
  if (reassignTo !== null && reassignTo !== "" && !isId(reassignTo)) return { ok: false, message: "Choose the colleague again." };
  const why = text(reason);
  const problem = validateReason(why);
  if (problem) return { ok: false, message: problem };
  const { data, error } = await ctx.supabase.rpc("set_member_status", {
    p_organization_id: ctx.orgId,
    p_user_id: userId,
    p_status: status,
    p_reason: why.trim(),
    p_reassign_to: reassignTo || null,
  });
  if (error) return done(error, status === "disabled" ? "disable this person" : "re-enable this person");
  const moved = Object.values((data ?? {}) as Record<string, number>).reduce((s, n) => s + n, 0);
  return done(null, "", {
    message:
      status === "disabled"
        ? `Disabled. ${moved ? `${moved} open item${moved === 1 ? "" : "s"} moved to the colleague you chose.` : "They had no open work."}`
        : "Re-enabled — they can sign in again.",
  });
}

/* ── Teams (admins write them directly; the database allows only admins) ── */

export async function saveTeam(teamId: unknown, name: unknown): Promise<TeamResult> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const n = text(name);
  const problem = validateTeamName(n);
  if (problem) return { ok: false, message: problem };
  if (teamId) {
    if (!isId(teamId)) return { ok: false, message: "That team couldn't be found." };
    const { error } = await ctx.supabase.from("teams").update({ name: n.trim() }).eq("id", teamId);
    return done(error, "rename this team", { message: "Team renamed." });
  }
  const { error } = await ctx.supabase.from("teams").insert({ organization_id: ctx.orgId, name: n.trim() });
  return done(error, "create this team", { message: `Team “${n.trim()}” created.` });
}

/** Only empty teams can be deleted, so no sales manager loses sight of records by accident. */
export async function deleteTeam(teamId: unknown): Promise<TeamResult> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  if (!isId(teamId)) return { ok: false, message: "That team couldn't be found." };
  const { count } = await ctx.supabase.from("team_members").select("user_id", { count: "exact", head: true }).eq("team_id", teamId);
  if (count) return { ok: false, message: "Remove everyone from the team first." };
  const { error } = await ctx.supabase.from("teams").delete().eq("id", teamId);
  return done(error, "delete this team", { message: "Team deleted." });
}

/** Adds someone to a team (or updates whether they manage it), or removes them. */
export async function setTeamMember(teamId: unknown, userId: unknown, inTeam: unknown, isManager: unknown): Promise<TeamResult> {
  const ctx = await adminContext();
  if ("message" in ctx) return { ok: false, message: ctx.message };
  if (!isId(teamId) || !isId(userId) || typeof inTeam !== "boolean") return { ok: false, message: "Choose the team and person again." };
  if (!inTeam) {
    const { error } = await ctx.supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", userId);
    return done(error, "remove them from the team", { message: "Removed from the team." });
  }
  const { error } = await ctx.supabase
    .from("team_members")
    .upsert({ team_id: teamId, organization_id: ctx.orgId, user_id: userId, is_manager: isManager === true }, { onConflict: "team_id,user_id" });
  return done(error, "update the team", { message: "Team updated." });
}

/** Database errors as plain sentences. Messages raised by our own database functions are already written for people. */
function friendly(error: PostgrestError, action: string) {
  if (error.code === "23505") return "A team with that name already exists.";
  if (error.code === "PGRST116" || /row-level security|permission denied for/i.test(error.message)) return `You don't have permission to ${action}.`;
  if (["P0001", "P0002", "22023", "42501"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514") return "Some details weren't accepted. Check them and try again.";
  return `Couldn't ${action}. Try again in a moment.`;
}
