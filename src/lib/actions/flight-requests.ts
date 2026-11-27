"use server";

// Reading flight requests (Phase 3). Server Actions are public endpoints: every input is re-checked here
// and every write runs as the signed-in user (Row Level Security has the final say).
//
//  1. readFlightRequest: checks the text for personal data, logs the reading in ai_actions (the database
//     enforces the 50-per-day limit and repeats the personal-data check), reads it with the local reader
//     (src/lib/flight-request-parser.ts: on this server, no AI service, no cost) and returns a DRAFT for
//     the agent to review. Nothing is saved as a flight search here.
//  2. saveFlightRequest: only after the agent confirms they reviewed the details; saves the search
//     (not searched: no live supplier) and marks the reading Applied.
//  3. discardFlightRequest: marks the reading Rejected.
// The linked lead / customer is only stored as a link; it is never part of the request text.
import { refresh } from "next/cache";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";
import { parseFlightRequest, READER_VERSION } from "@/lib/flight-request-parser";
import {
  DAILY_LIMIT,
  draftFromInput,
  draftFromReading,
  requestTextProblem,
  searchRow,
  validateDraft,
  type DraftErrors,
  type FlightRequestDraft,
} from "@/lib/flight-request";

export type ReadResult =
  | { ok: true; actionId: string; draft: FlightRequestDraft; questions: string[]; remaining: number }
  | { ok: false; message: string; remaining?: number };
export type SaveResult = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: DraftErrors };

/** Same roles that may create flight searches (RLS, migration 10). */
const ALLOWED: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const todayUtc = () => new Date().toISOString().slice(0, 10);

async function context() {
  const user = await getCurrentUser();
  const m = user.membership;
  if (!m) return { message: "Your login isn't linked to an agency yet. Ask your admin." } as const;
  if (!ALLOWED.includes(m.role)) return { message: "Your role can't create flight searches." } as const;
  return { user, orgId: m.organizationId, supabase: await createClient() } as const;
}

/** "lead:LD-2001" / "customer:CU-1001" / "" → database id and the names to keep out of the request text. */
async function resolveLink(supabase: SupabaseClient, orgId: string, link: unknown) {
  const value = typeof link === "string" ? link : "";
  const [kind, code] = value.split(":");
  if (kind === "lead" && /^LD-\d+$/.test(code ?? "")) {
    const { data } = await supabase.from("leads").select("id, full_name").eq("organization_id", orgId).eq("code", code).is("deleted_at", null).maybeSingle();
    return data ? { lead_id: data.id as string, customer_id: null, names: [data.full_name as string] } : null;
  }
  if (kind === "customer" && /^CU-\d+$/.test(code ?? "")) {
    const { data } = await supabase.from("customers").select("id, first_name, last_name").eq("organization_id", orgId).eq("code", code).is("deleted_at", null).maybeSingle();
    return data ? { lead_id: null, customer_id: data.id as string, names: [`${data.first_name} ${data.last_name}`] } : null;
  }
  return value ? null : { lead_id: null, customer_id: null, names: [] as string[] };
}

async function usedToday(supabase: SupabaseClient, userId: string) {
  const { count } = await supabase
    .from("ai_actions")
    .select("id", { count: "exact", head: true })
    .eq("requested_by", userId)
    .eq("action_kind", "Flight request")
    .gte("created_at", `${todayUtc()}T00:00:00Z`);
  return count ?? 0;
}

function dbMessage(error: PostgrestError | null, fallback: string) {
  if (error && error.code === "P0001") return error.message; // our own database messages (limit, personal data)
  return fallback;
}

export async function readFlightRequest(text: unknown, link: unknown): Promise<ReadResult> {
  const ctx = await context();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const { user, orgId, supabase } = ctx;

  const linked = await resolveLink(supabase, orgId, link);
  if (!linked) return { ok: false, message: "That lead or customer couldn't be found." };
  const problem = requestTextProblem(text, linked.names);
  if (problem) return { ok: false, message: problem };

  const today = todayUtc();
  const requestText = (text as string).trim();
  // Logged before it is read: the database enforces the daily limit and the personal-data check here.
  const { data: action, error } = await supabase
    .from("ai_actions")
    .insert({
      organization_id: orgId,
      action_kind: "Flight request",
      status: "Proposed",
      model: READER_VERSION,
      input: { text: requestText, today },
      lead_id: linked.lead_id,
      customer_id: linked.customer_id,
      cost_usd: 0,
    })
    .select("id")
    .single();
  if (error || !action) return { ok: false, message: dbMessage(error, "The request couldn't be logged, so it wasn't read. Try again."), remaining: Math.max(0, DAILY_LIMIT - (await usedToday(supabase, user.id))) };

  const remaining = Math.max(0, DAILY_LIMIT - (await usedToday(supabase, user.id)));
  let reading;
  try {
    reading = parseFlightRequest(requestText, today);
  } catch (e) {
    console.error("Flight-request reading failed:", String((e as Error)?.name));
    await supabase.from("ai_actions").update({ status: "Failed", error: "reader-error" }).eq("id", action.id);
    return { ok: false, message: "The request couldn't be read. Fill in the details yourself.", remaining };
  }

  const { draft, questions } = draftFromReading(reading, today);
  await supabase
    .from("ai_actions")
    .update({ output: { extraction: reading, draft, questions } })
    .eq("id", action.id);
  return { ok: true, actionId: action.id as string, draft, questions, remaining };
}

/** Saves the search ONLY after the agent confirms they reviewed and approve the details. */
export async function saveFlightRequest(actionId: unknown, raw: unknown, link: unknown, reviewed: unknown): Promise<SaveResult> {
  if (reviewed !== true) return { ok: false, message: "Confirm that you've reviewed the details before saving." };
  if (typeof actionId !== "string" || !UUID_RE.test(actionId)) return { ok: false, message: "That reading couldn't be found." };
  const ctx = await context();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const { user, orgId, supabase } = ctx;

  const { data: action } = await supabase
    .from("ai_actions")
    .select("id, status, action_kind, requested_by, output")
    .eq("id", actionId)
    .maybeSingle<{ id: string; status: string; action_kind: string; requested_by: string; output: { questions?: string[] } | null }>();
  if (!action || action.action_kind !== "Flight request" || action.requested_by !== user.id)
    return { ok: false, message: "That reading couldn't be found." };
  if (action.status !== "Proposed") return { ok: false, message: "This reading was already saved or discarded." };

  const v = draftFromInput(raw);
  const fieldErrors = validateDraft(v, todayUtc());
  if (Object.keys(fieldErrors).length) return { ok: false, message: "Some details need attention.", fieldErrors };

  const linked = await resolveLink(supabase, orgId, link);
  if (!linked) return { ok: false, message: "That lead or customer couldn't be found." };

  const row = searchRow(v, action.id, Array.isArray(action.output?.questions) ? action.output!.questions! : []);
  const { data: search, error } = await supabase
    .from("flight_searches")
    .insert({ organization_id: orgId, ...row, lead_id: linked.lead_id, customer_id: linked.customer_id })
    .select("id")
    .single();
  if (error || !search) return { ok: false, message: "The search couldn't be saved. Check the details and try again." };

  await supabase
    .from("ai_actions")
    .update({ status: "Applied", applied_at: new Date().toISOString(), flight_search_id: search.id, lead_id: linked.lead_id, customer_id: linked.customer_id })
    .eq("id", action.id);
  refresh();
  return {
    ok: true,
    message: `Saved ${[row, ...row.request.further_legs].map((l) => `${l.origin} → ${l.destination}`).join(", ")}${row.return_on ? " (return)" : ""}. Not searched: no live flight supplier is connected, so no fares or availability are shown.`,
  };
}

export async function discardFlightRequest(actionId: unknown): Promise<SaveResult> {
  if (typeof actionId !== "string" || !UUID_RE.test(actionId)) return { ok: false, message: "That reading couldn't be found." };
  const ctx = await context();
  if ("message" in ctx) return { ok: false, message: ctx.message! };
  const { user, supabase } = ctx;
  const { data } = await supabase
    .from("ai_actions")
    .update({ status: "Rejected" })
    .eq("id", actionId)
    .eq("requested_by", user.id)
    .eq("action_kind", "Flight request")
    .eq("status", "Proposed")
    .select("id")
    .maybeSingle();
  return data ? { ok: true, message: "Discarded. Nothing was saved." } : { ok: false, message: "This reading was already saved or discarded." };
}

/** For the page: whether reading is available to this person, and how many readings are left today. */
export async function flightRequestStatus(): Promise<{ allowed: boolean; remaining: number }> {
  const ctx = await context();
  if ("message" in ctx) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: Math.max(0, DAILY_LIMIT - (await usedToday(ctx.supabase, ctx.user.id))) };
}
