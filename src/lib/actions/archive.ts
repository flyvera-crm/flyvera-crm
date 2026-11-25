"use server";

// Archive & restore for customers, leads and quotations.
// Archiving uses the database functions (migrations 14 + 21): whoever may edit the record may archive it,
// except a customer with active bookings or a quotation that became a booking. Archived records are
// hidden from everyone but admins; only admins list and restore them (Row Level Security enforces both).
import { refresh } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ArchiveKind = "customer" | "lead" | "quotation";
export type ArchiveResult = { ok: true; message: string } | { ok: false; message: string };
export type ArchivedRow = { dbId: string; code: string; label: string; archivedOn: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ArchiveKind[] = ["customer", "lead", "quotation"];
const TABLE: Record<ArchiveKind, string> = { customer: "customers", lead: "leads", quotation: "quotations" };
const NOUN: Record<ArchiveKind, string> = { customer: "customer", lead: "lead", quotation: "quotation" };

export async function archiveRecord(kind: unknown, dbId: unknown): Promise<ArchiveResult> {
  if (!KINDS.includes(kind as ArchiveKind) || typeof dbId !== "string" || !UUID_RE.test(dbId)) return { ok: false, message: "That record couldn't be found." };
  const k = kind as ArchiveKind;
  const supabase = await createClient();
  const { error } = await supabase.rpc(`archive_${k}`, { [`p_${k}_id`]: dbId });
  if (error) return { ok: false, message: friendly(error, `archive this ${NOUN[k]}`) };
  refresh();
  return { ok: true, message: `The ${NOUN[k]} was archived. An admin can restore it.` };
}

export async function listArchived(kind: unknown): Promise<{ ok: true; rows: ArchivedRow[] } | { ok: false; message: string }> {
  if (!KINDS.includes(kind as ArchiveKind)) return { ok: false, message: "Unknown list." };
  const k = kind as ArchiveKind;
  if ((await getCurrentUser()).membership?.role !== "admin") return { ok: false, message: "Only admins see archived records." };
  const supabase = await createClient();
  const columns = k === "customer" ? "id, code, first_name, last_name, deleted_at" : k === "lead" ? "id, code, full_name, deleted_at" : "id, code, title, deleted_at";
  const { data, error } = await supabase.from(TABLE[k]).select(columns).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(200);
  if (error) return { ok: false, message: friendly(error, "load archived records") };
  const rows = ((data ?? []) as unknown as Record<string, string | null>[]).map((r) => ({
    dbId: r.id!,
    code: r.code ?? "",
    label: k === "customer" ? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() : k === "lead" ? (r.full_name ?? "") : (r.title ?? ""),
    archivedOn: (r.deleted_at ?? "").slice(0, 10),
  }));
  return { ok: true, rows };
}

export async function restoreRecord(kind: unknown, dbId: unknown): Promise<ArchiveResult> {
  if (!KINDS.includes(kind as ArchiveKind) || typeof dbId !== "string" || !UUID_RE.test(dbId)) return { ok: false, message: "That record couldn't be found." };
  const k = kind as ArchiveKind;
  if ((await getCurrentUser()).membership?.role !== "admin") return { ok: false, message: "Only admins restore archived records." };
  const supabase = await createClient();
  const { data, error } = await supabase.from(TABLE[k]).update({ deleted_at: null }).eq("id", dbId).select("code").maybeSingle();
  if (error || !data) return { ok: false, message: friendly(error, `restore this ${NOUN[k]}`) };
  refresh();
  return { ok: true, message: `${data.code} restored.` };
}

function friendly(error: PostgrestError | null, action: string) {
  if (!error) return `Couldn't ${action}. Try again in a moment.`;
  if (/row-level security|permission denied for/i.test(error.message)) return `You don't have permission to ${action}.`;
  if (["P0001", "42501"].includes(error.code ?? "")) return error.message;
  if (error.code === "23505") return "Another active record already uses the same details (e.g. phone number). Change that one first.";
  return `Couldn't ${action}. Try again in a moment.`;
}
