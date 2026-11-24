"use server";

// Lead activity log. Anyone who can see a lead may add to its log (Row Level Security: lead_visible and
// created_by = you); entries can't be edited or deleted. Stage changes are logged by the database itself
// (migration 21). Logging a call / WhatsApp / email / meeting also updates the lead's "Last contact"
// (and next follow-up, if given) for people allowed to edit the lead.
import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLeadData } from "@/lib/data/leads";
import { agentName, getTeam } from "@/lib/data/team";
import { CONTACT_TYPES, LOG_TYPES, validateActivity, type LeadActivityEntry, type LogType } from "@/lib/lead-activity-rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; activity_type: string; body: string | null; from_stage: string | null; to_stage: string | null; occurred_at: string; created_by: string | null };

export async function getLeadActivity(leadDbId: unknown): Promise<{ ok: true; entries: LeadActivityEntry[] } | { ok: false; message: string }> {
  if (typeof leadDbId !== "string" || !UUID_RE.test(leadDbId)) return { ok: false, message: "That lead couldn't be found." };
  const supabase = await createClient();
  const [{ data, error }, team] = await Promise.all([
    supabase
      .from("lead_activities")
      .select("id, activity_type, body, from_stage, to_stage, occurred_at, created_by")
      .eq("lead_id", leadDbId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    getTeam(),
  ]);
  if (error) return { ok: false, message: "The activity couldn't be loaded. Try again in a moment." };
  return {
    ok: true,
    entries: ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      type: r.activity_type,
      body: r.body ?? undefined,
      fromStage: r.from_stage ?? undefined,
      toStage: r.to_stage ?? undefined,
      at: r.occurred_at,
      by: r.created_by ? agentName(team, r.created_by) : "System",
    })),
  };
}

export async function logLeadActivity(leadDbId: unknown, raw: unknown): Promise<{ ok: true; entries: LeadActivityEntry[] } | { ok: false; message: string }> {
  if (typeof leadDbId !== "string" || !UUID_RE.test(leadDbId)) return { ok: false, message: "That lead couldn't be found." };
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const v = {
    type: (LOG_TYPES.includes(r.type as LogType) ? r.type : "") as LogType | "",
    body: typeof r.body === "string" ? r.body : "",
    nextFollowUp: typeof r.nextFollowUp === "string" ? r.nextFollowUp : "",
  };
  const today = new Date().toISOString().slice(0, 10);
  const problem = Object.values(validateActivity(v, today)).find(Boolean);
  if (problem) return { ok: false, message: problem };

  const user = await getCurrentUser();
  if (!user.membership) return { ok: false, message: "Your login isn't linked to an agency yet." };
  const supabase = await createClient();
  const { error } = await supabase.from("lead_activities").insert({
    organization_id: user.membership.organizationId,
    lead_id: leadDbId,
    activity_type: v.type,
    body: v.body.trim(),
  });
  if (error) {
    return { ok: false, message: /row-level security/i.test(error.message) ? "You can only log activity on leads you can see." : "The activity couldn't be saved. Try again." };
  }

  // Contact made: keep the lead's dates current (only for people who may edit the lead).
  const { access } = await getLeadData();
  if (access.canEdit && (CONTACT_TYPES.includes(v.type as LogType) || v.nextFollowUp)) {
    const patch: Record<string, string> = {};
    if (CONTACT_TYPES.includes(v.type as LogType)) patch.last_contacted_at = new Date().toISOString();
    if (v.nextFollowUp) patch.next_follow_up_on = v.nextFollowUp;
    await supabase.from("leads").update(patch).eq("id", leadDbId);
  }
  refresh();
  return getLeadActivity(leadDbId);
}
