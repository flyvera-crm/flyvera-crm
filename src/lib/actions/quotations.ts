"use server";

// Save quotations (with line items), change their status, and duplicate them.
// Server Actions are public endpoints: every input is re-checked here, and every
// write runs as the signed-in user, so Row Level Security has the final say.
import { refresh } from "next/cache";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { QuoteItemType, QuoteStatus, Quotation } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { getAgencySettings } from "@/lib/data/settings";
import { getCurrentUser } from "@/lib/auth";
import { getTeam } from "@/lib/data/team";
import { mapQuote, QUOTE_COLUMNS, type QuoteRow } from "@/lib/data/quotations";
import {
  emptyQuoteForm,
  freshValidity,
  parseAmount,
  validateQuote,
  type QuoteFormValues,
  type QuoteItemDraft,
  type QuoteMessages,
} from "@/lib/quote-validation";
import { QUOTE_ITEM_TYPES } from "@/config/quote-options";
import { confirmQuoteStatus, planStatusChange, QUOTE_CHANGED_MESSAGE } from "@/lib/quote-status";
import { quoteSaveLogLine, type QuoteSaveOutcome } from "@/lib/quote-save-log";
import { newRequestId } from "@/lib/stage-change-log";

export type SaveQuoteResult = { ok: true; quote: Quotation } | { ok: false; message: string; fieldErrors?: QuoteMessages };
export type QuoteResult = { ok: true; quote: Quotation } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 100;
const ITEM_TYPES = QUOTE_ITEM_TYPES.map((t) => t.value);
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const today = () => new Date().toISOString().slice(0, 10);

/* ─────────────────────────── save ─────────────────────────── */

export async function saveQuote(target: { dbId?: string }, raw: unknown): Promise<SaveQuoteResult> {
  // Diagnostic: one server-log line per save (random request ID, outcome, the database's quotation code; nothing else).
  const requestId = newRequestId();
  const done = (outcome: QuoteSaveOutcome, result: SaveQuoteResult, code?: string) => {
    console.info(quoteSaveLogLine({ requestId, outcome, code }));
    return result;
  };

  const user = await getCurrentUser();
  if (!user.membership) return done("invalid", { ok: false, message: "Your login isn't linked to an agency yet. Ask your admin." });
  const orgId = user.membership.organizationId;
  const editing = typeof target?.dbId === "string";
  if (editing && !UUID_RE.test(target.dbId!)) return done("not-found", { ok: false, message: "That quotation couldn't be found." });

  const values = cleanValues(raw);
  if (!values) return done("invalid", { ok: false, message: "The quotation couldn't be read. Reload the page and try again." });
  const { errors } = validateQuote(values, today());
  if (Object.keys(errors).length) return done("invalid", { ok: false, message: "Some details need attention.", fieldErrors: errors });

  const supabase = await createClient();

  let existing: { id: string; status: QuoteStatus } | null = null;
  if (editing) {
    const { data } = await supabase.from("quotations").select("id, status").eq("id", target.dbId!).is("deleted_at", null).maybeSingle();
    if (!data) return done("not-found", { ok: false, message: "This quotation no longer exists, or you can't edit it." });
    if (data.status === "Accepted" || data.status === "Declined")
      return done("invalid", { ok: false, message: `This quotation was ${data.status.toLowerCase()} and can't be changed. Duplicate it instead.` });
    existing = data;
  }

  // Who it's for: the live link plus a snapshot of their details, so the document never changes later.
  const recipient = await resolveRecipient(supabase, orgId, values.recipient);
  if (!recipient) {
    return done("invalid", {
      ok: false,
      message: "Choose who this quotation is for.",
      fieldErrors: { recipient: "That customer or lead isn't available to you." },
    });
  }

  const row = {
    customer_id: recipient.kind === "customer" ? recipient.id : null,
    lead_id: recipient.kind === "lead" ? recipient.id : null,
    recipient: recipient.snapshot,
    title: tidy(values.title),
    destination: tidy(values.destination),
    depart_on: values.departDate || null,
    return_on: values.returnDate || null,
    adults: Number(values.adults),
    children: Number(values.children || "0"),
    discount: values.discount.trim() ? parseAmount(values.discount) : 0,
    tax_rate: parseAmount(values.taxRate || "0"),
    valid_until: values.validUntil,
    notes: values.notes.trim() || null,
    prepared_by: values.agent,
  };

  // An edit only applies while the quotation is still Draft or Sent (it may have been answered meanwhile).
  const saved = editing
    ? await supabase.from("quotations").update(row).eq("id", existing!.id).in("status", ["Draft", "Sent"]).select("id").maybeSingle()
    : await supabase.from("quotations").insert({ ...row, organization_id: orgId, status: "Draft" }).select("id").maybeSingle();
  if (editing && !saved.error && !saved.data) return done("insert-failed", { ok: false, message: QUOTE_CHANGED_MESSAGE });
  if (saved.error || !saved.data) return done("insert-failed", { ok: false, ...failure(saved.error, "save this quotation") });
  const quoteId = saved.data.id as string;

  const itemsError = await saveItems(supabase, orgId, quoteId, values.items, editing);
  const quote = await loadQuote(supabase, quoteId);
  refresh();
  if (itemsError) {
    return done(
      "items-failed",
      { ok: false, message: `The quotation was saved, but its items weren't all saved (${itemsError}). Open it and check the items.` },
      quote?.id,
    );
  }
  if (!quote) return done("not-found", { ok: false, message: "Saved, but the quotation couldn't be reloaded. Refresh the page." });
  return done("ok", { ok: true, quote }, quote.id);
}

/**
 * Line items, in an order that never leaves the quotation without its items:
 * 1) update lines that already exist, 2) add new lines, 3) remove lines that were deleted.
 * If the connection drops midway, the worst case is an extra old line — never lost data.
 */
async function saveItems(supabase: SupabaseClient, orgId: string, quoteId: string, items: QuoteItemDraft[], editing: boolean) {
  const toRow = (i: QuoteItemDraft, position: number) => ({
    position,
    item_type: i.type,
    description: tidy(i.description),
    quantity: parseAmount(i.quantity),
    unit_price: parseAmount(i.unitPrice),
    cost: i.cost.trim() ? parseAmount(i.cost) : 0,
  });

  let currentIds = new Set<string>();
  if (editing) {
    const { data } = await supabase.from("quotation_items").select("id").eq("quotation_id", quoteId);
    currentIds = new Set((data ?? []).map((r) => r.id as string));
  }

  const keep = new Set<string>();
  for (const [position, item] of items.entries()) {
    if (item.dbId && currentIds.has(item.dbId)) {
      const { error } = await supabase.from("quotation_items").update(toRow(item, position)).eq("id", item.dbId);
      if (error) return "an item couldn't be updated";
      keep.add(item.dbId);
    }
  }

  const fresh = items
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => !(item.dbId && keep.has(item.dbId)))
    .map(({ item, position }) => ({ ...toRow(item, position), organization_id: orgId, quotation_id: quoteId }));
  if (fresh.length) {
    const { error } = await supabase.from("quotation_items").insert(fresh);
    if (error) return "new items couldn't be added";
  }

  const removed = [...currentIds].filter((id) => !keep.has(id));
  if (removed.length) {
    const { error } = await supabase.from("quotation_items").delete().in("id", removed);
    if (error) return "removed items couldn't be deleted";
  }
  return null;
}

/* ─────────────────────────── status & duplicate ─────────────────────────── */

export async function setQuoteStatus(dbId: unknown, status: unknown): Promise<QuoteResult> {
  if (typeof dbId !== "string" || !UUID_RE.test(dbId)) return { ok: false, message: "That quotation couldn't be found." };
  if (status !== "Sent" && status !== "Accepted" && status !== "Declined") return { ok: false, message: "That status isn't valid." };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("quotations")
    .select("id, status, sent_at")
    .eq("id", dbId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; status: QuoteStatus; sent_at: string | null }>();
  if (!current) return { ok: false, message: "This quotation no longer exists, or you can't change it." };
  const plan = planStatusChange(current, status, new Date().toISOString());
  if (!plan.ok) return plan;

  // Applies only if the status is still the one checked above, and must report the changed row:
  // a refused or overtaken update changes nothing and is never reported as saved.
  const { data: changed, error } = await supabase
    .from("quotations")
    .update(plan.update)
    .eq("id", dbId)
    .eq("status", current.status)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: failure(error, "change this quotation").message };
  if (!changed) return { ok: false, message: QUOTE_CHANGED_MESSAGE };
  const quote = await loadQuote(supabase, dbId);
  refresh();
  return quote
    ? confirmQuoteStatus({ ok: true, quote }, status)
    : { ok: false, message: "Saved, but the quotation couldn't be reloaded. Refresh the page." };
}

/** Copies a quotation (and its items) into a new Draft that's valid from today. */
export async function duplicateQuote(dbId: unknown): Promise<QuoteResult> {
  if (typeof dbId !== "string" || !UUID_RE.test(dbId)) return { ok: false, message: "That quotation couldn't be found." };
  const user = await getCurrentUser();
  if (!user.membership) return { ok: false, message: "Your login isn't linked to an agency yet. Ask your admin." };
  const supabase = await createClient();

  const { data: src } = await supabase.from("quotations").select(QUOTE_COLUMNS).eq("id", dbId).maybeSingle<QuoteRow>();
  if (!src) return { ok: false, message: "This quotation no longer exists, or you can't copy it." };

  const { data: copy, error } = await supabase
    .from("quotations")
    .insert({
      organization_id: user.membership.organizationId,
      customer_id: src.customer_id,
      lead_id: src.lead_id,
      recipient: src.recipient,
      title: src.title,
      destination: src.destination,
      depart_on: src.depart_on,
      return_on: src.return_on,
      adults: src.adults,
      children: src.children,
      discount: src.discount,
      tax_rate: src.tax_rate,
      valid_until: freshValidity(today(), (await getAgencySettings()).defaults.quoteValidityDays),
      status: "Draft",
      notes: src.notes,
      prepared_by: src.prepared_by,
    })
    .select("id")
    .maybeSingle();
  if (error || !copy) return { ok: false, message: failure(error, "copy this quotation").message };

  const items = [...(src.items ?? [])].sort((a, b) => a.position - b.position);
  if (items.length) {
    const { error: itemsError } = await supabase.from("quotation_items").insert(
      items.map((i, position) => ({
        organization_id: user.membership!.organizationId,
        quotation_id: copy.id,
        position,
        item_type: i.item_type,
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unit_price,
        cost: i.cost,
      })),
    );
    if (itemsError) {
      refresh();
      return { ok: false, message: "The copy was created, but its items couldn't be copied. Open it and add them." };
    }
  }

  const quote = await loadQuote(supabase, copy.id as string);
  refresh();
  return quote ? { ok: true, quote } : { ok: false, message: "Copied, but the new draft couldn't be loaded. Refresh the page." };
}

/* ─────────────────────────── helpers ─────────────────────────── */

async function loadQuote(supabase: SupabaseClient, id: string) {
  const { data } = await supabase.from("quotations").select(QUOTE_COLUMNS).eq("id", id).maybeSingle<QuoteRow>();
  return data ? mapQuote(data, await getTeam()) : null;
}

/** "customer:CU-1001" / "lead:LD-2001" → database id + a snapshot of name, email and phone. */
async function resolveRecipient(supabase: SupabaseClient, orgId: string, value: string) {
  const [kind, code] = value.split(":");
  if (kind === "customer" && /^CU-\d+$/.test(code ?? "")) {
    const { data } = await supabase
      .from("customers")
      .select("id, code, first_name, last_name, email, phone")
      .eq("organization_id", orgId)
      .eq("code", code)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return null;
    return {
      kind: "customer" as const,
      id: data.id as string,
      snapshot: { kind, code: data.code, name: `${data.first_name} ${data.last_name}`, email: data.email, phone: data.phone },
    };
  }
  if (kind === "lead" && /^LD-\d+$/.test(code ?? "")) {
    const { data } = await supabase
      .from("leads")
      .select("id, code, full_name, email, phone")
      .eq("organization_id", orgId)
      .eq("code", code)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return null;
    return {
      kind: "lead" as const,
      id: data.id as string,
      snapshot: { kind, code: data.code, name: data.full_name, email: data.email, phone: data.phone },
    };
  }
  return null;
}

/** Keeps only known fields with the right types (the browser can send anything). */
function cleanValues(raw: unknown): QuoteFormValues | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const date = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : "");
  const rawItems = Array.isArray(r.items) ? r.items.slice(0, MAX_ITEMS) : [];
  const items: QuoteItemDraft[] = rawItems.map((x, index) => {
    const i = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const dbId = str(i.dbId);
    return {
      id: str(i.id) || `i${index + 1}`,
      dbId: UUID_RE.test(dbId) ? dbId : undefined,
      type: ITEM_TYPES.includes(i.type as QuoteItemType) ? (i.type as QuoteItemType) : "Other",
      description: str(i.description),
      quantity: str(i.quantity),
      unitPrice: str(i.unitPrice),
      cost: str(i.cost),
    };
  });
  const agent = str(r.agent);
  return {
    ...emptyQuoteForm(today()),
    recipient: str(r.recipient),
    title: str(r.title),
    destination: str(r.destination),
    departDate: date(r.departDate),
    returnDate: date(r.returnDate),
    adults: str(r.adults),
    children: str(r.children),
    items,
    discount: str(r.discount),
    taxRate: str(r.taxRate),
    validUntil: date(r.validUntil),
    agent: UUID_RE.test(agent) ? agent : "",
    notes: str(r.notes),
  };
}

function failure(error: PostgrestError | null, action: string): { message: string; fieldErrors?: QuoteMessages } {
  if (!error || error.code === "42501" || error.code === "PGRST116" || /row-level security/i.test(error.message)) {
    return { message: `You don't have permission to ${action} with these details.` };
  }
  if (error.code === "23503") {
    return { message: "The selected agent isn't an active member of your agency.", fieldErrors: { agent: "Choose another agent." } };
  }
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007") {
    return { message: "Some details weren't accepted. Check the dates, amounts and items and try again." };
  }
  return { message: `Couldn't ${action}. Try again in a moment.` };
}
