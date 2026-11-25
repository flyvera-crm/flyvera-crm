"use server";

// Add / edit leads, and quick status changes (stage moves, Undo, conversion).
// Server Actions are public endpoints: every input is re-checked here, and every
// write runs as the signed-in user, so Row Level Security has the final say.
import { refresh } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import type { Lead, LeadPriority, LeadSource, LeadStage, TripType } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getTeam } from "@/lib/data/team";
import { LEAD_COLUMNS, mapLead, type LeadRow } from "@/lib/data/leads";
import {
  emptyLeadForm,
  parseBudget,
  validateLead,
  type LeadFormValues,
  type LeadMessages,
} from "@/lib/lead-validation";
import { LEAD_PRIORITIES, LEAD_SOURCES, LEAD_STAGES, TRIP_TYPES } from "@/config/lead-options";

export type SaveLeadResult = { ok: true; lead: Lead } | { ok: false; message: string; fieldErrors?: LeadMessages };
export type LeadStatusResult = { ok: true; lead: Lead } | { ok: false; message: string };

/** A quick change to a lead's status. Fields left out keep their current value. */
export type LeadStatusPatch = {
  stage?: LeadStage;
  lostReason?: string | null;
  nextFollowUp?: string | null; // YYYY-MM-DD
  /** YYYY-MM-DD; default = now. Undo passes the previous date back. */
  lastContact?: string;
  /** Link to a customer (by code, e.g. "CU-1001") once converted. */
  customerCode?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAGES = LEAD_STAGES.map((s) => s.value);
const isClosed = (stage: LeadStage) => stage === "Won" || stage === "Lost";
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

export async function saveLead(target: { dbId?: string }, raw: unknown): Promise<SaveLeadResult> {
  const user = await getCurrentUser();
  if (!user.membership) return { ok: false, message: "Your login isn't linked to an agency yet. Ask your admin." };
  const editing = typeof target?.dbId === "string";
  if (editing && !UUID_RE.test(target.dbId!)) return { ok: false, message: "That lead couldn't be found." };

  const values = cleanValues(raw);
  const today = new Date().toISOString().slice(0, 10);
  const { errors } = validateLead(values, [], [], today);
  if (Object.keys(errors).length) return { ok: false, message: "Some details need attention.", fieldErrors: errors };

  const supabase = await createClient();
  let existing: { id: string; lost_reason: string | null } | null = null;
  if (editing) {
    const { data } = await supabase.from("leads").select("id, lost_reason").eq("id", target.dbId!).is("deleted_at", null).maybeSingle();
    if (!data) return { ok: false, message: "This lead no longer exists, or you can't edit it." };
    existing = data;
  }

  const row = {
    full_name: tidy(values.name),
    phone: tidy(values.phone),
    email: values.email.trim().toLowerCase() || null,
    source: values.source,
    stage: values.stage,
    priority: values.priority,
    destination: tidy(values.destination),
    trip_type: values.tripType,
    depart_on: values.departDate || null,
    return_on: values.returnDate || null,
    travellers: Number(values.travellers),
    budget: parseBudget(values.budget),
    assigned_to: values.agent,
    next_follow_up_on: values.nextFollowUp || null,
    notes: tidy(values.notes) || null,
    lost_reason: values.stage === "Lost" ? (existing?.lost_reason ?? null) : null,
  };

  const saved = editing
    ? await supabase.from("leads").update(row).eq("id", existing!.id).select(LEAD_COLUMNS).maybeSingle<LeadRow>()
    : await supabase
        .from("leads")
        .insert({ ...row, organization_id: user.membership.organizationId, last_contacted_at: new Date().toISOString() })
        .select(LEAD_COLUMNS)
        .maybeSingle<LeadRow>();
  if (saved.error || !saved.data) return { ok: false, ...failure(saved.error, "save this lead") };

  refresh();
  return { ok: true, lead: mapLead(saved.data, await getTeam()) };
}

export async function setLeadStatus(dbId: unknown, rawPatch: unknown): Promise<LeadStatusResult> {
  if (typeof dbId !== "string" || !UUID_RE.test(dbId)) return { ok: false, message: "That lead couldn't be found." };
  const patch = cleanPatch(rawPatch);
  if (!patch) return { ok: false, message: "That change isn't valid." };

  const user = await getCurrentUser();
  if (!user.membership) return { ok: false, message: "Your login isn't linked to an agency yet. Ask your admin." };
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("leads")
    .select("id, stage, lost_reason, next_follow_up_on")
    .eq("id", dbId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; stage: LeadStage; lost_reason: string | null; next_follow_up_on: string | null }>();
  if (!current) return { ok: false, message: "This lead no longer exists, or you can't change it." };

  const stage = patch.stage ?? current.stage;
  const update: Record<string, unknown> = {
    stage,
    lost_reason: stage === "Lost" ? (patch.lostReason !== undefined ? patch.lostReason : current.lost_reason) : null,
    next_follow_up_on: isClosed(stage)
      ? null
      : patch.nextFollowUp !== undefined
        ? patch.nextFollowUp
        : current.next_follow_up_on,
    last_contacted_at: patch.lastContact ? `${patch.lastContact}T12:00:00Z` : new Date().toISOString(),
  };

  if (patch.customerCode) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("organization_id", user.membership.organizationId)
      .eq("code", patch.customerCode)
      .maybeSingle();
    if (!customer) return { ok: false, message: `Customer ${patch.customerCode} wasn't found.` };
    update.customer_id = customer.id;
    update.converted_at = new Date().toISOString();
  }

  const { data, error } = await supabase.from("leads").update(update).eq("id", dbId).select(LEAD_COLUMNS).maybeSingle<LeadRow>();
  if (error || !data) return { ok: false, message: failure(error, "change this lead").message };

  refresh();
  return { ok: true, lead: mapLead(data, await getTeam()) };
}

/* ─────────────────────────── helpers ─────────────────────────── */

function cleanValues(raw: unknown): LeadFormValues {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof LeadFormValues) => (typeof r[k] === "string" ? (r[k] as string) : "");
  const pick = <T extends string>(k: keyof LeadFormValues, allowed: readonly T[], fallback: T) =>
    allowed.includes(r[k] as T) ? (r[k] as T) : fallback;
  const agent = str("agent");
  const date = (k: keyof LeadFormValues) => (DATE_RE.test(str(k)) ? str(k) : "");
  return {
    ...emptyLeadForm,
    name: str("name"),
    phone: str("phone"),
    email: str("email"),
    source: pick<LeadSource>("source", LEAD_SOURCES.map((s) => s.value), "WhatsApp"),
    destination: str("destination"),
    tripType: pick<TripType>("tripType", TRIP_TYPES, "Holiday"),
    departDate: date("departDate"),
    returnDate: date("returnDate"),
    travellers: str("travellers"),
    budget: str("budget"),
    stage: pick<LeadStage>("stage", STAGES, "New"),
    priority: pick<LeadPriority>("priority", LEAD_PRIORITIES, "Warm"),
    agent: UUID_RE.test(agent) ? agent : "",
    nextFollowUp: date("nextFollowUp"),
    notes: str("notes"),
  };
}

function cleanPatch(raw: unknown): LeadStatusPatch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const patch: LeadStatusPatch = {};
  if (r.stage !== undefined) {
    if (!STAGES.includes(r.stage as LeadStage)) return null;
    patch.stage = r.stage as LeadStage;
  }
  if (r.lostReason !== undefined) {
    if (r.lostReason !== null && (typeof r.lostReason !== "string" || r.lostReason.length > 120)) return null;
    patch.lostReason = (r.lostReason as string | null) || null;
  }
  if (r.nextFollowUp !== undefined) {
    if (r.nextFollowUp !== null && !(typeof r.nextFollowUp === "string" && DATE_RE.test(r.nextFollowUp))) return null;
    patch.nextFollowUp = r.nextFollowUp as string | null;
  }
  if (r.lastContact !== undefined) {
    if (typeof r.lastContact !== "string" || !DATE_RE.test(r.lastContact)) return null;
    patch.lastContact = r.lastContact;
  }
  if (r.customerCode !== undefined) {
    if (typeof r.customerCode !== "string" || !/^CU-\d+$/.test(r.customerCode)) return null;
    patch.customerCode = r.customerCode;
  }
  return patch;
}

function failure(error: PostgrestError | null, action: string): { message: string; fieldErrors?: LeadMessages } {
  if (!error || error.code === "42501" || error.code === "PGRST116" || /row-level security/i.test(error.message)) {
    return { message: `You don't have permission to ${action} with these details.` };
  }
  if (error.code === "23503") {
    return { message: "The selected agent isn't an active member of your agency.", fieldErrors: { agent: "Choose another agent." } };
  }
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007") {
    return { message: "Some details weren't accepted. Check the dates and amounts and try again." };
  }
  return { message: `Couldn't ${action}. Try again in a moment.` };
}
