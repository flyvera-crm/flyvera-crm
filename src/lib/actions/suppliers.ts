"use server";

// Supplier directory. Admin, ticketing and finance manage suppliers (checked here and by Row Level
// Security). Suppliers are deactivated, never deleted, so bookings and payments keep their link.
import { refresh } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { supplierAccess } from "@/lib/data/suppliers";
import { SUPPLIER_TYPES, supplierRow, validateSupplier, type SupplierForm, type SupplierType } from "@/lib/supplier-rules";

export type SupplierResult = { ok: true; message: string } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown) => (typeof v === "string" ? v : "");

async function managerContext() {
  const user = await getCurrentUser();
  if (!supplierAccess(user.membership?.role).canManage || !user.membership) return null;
  return { supabase: await createClient(), orgId: user.membership.organizationId };
}

export async function saveSupplier(supplierId: unknown, raw: unknown): Promise<SupplierResult> {
  const ctx = await managerContext();
  if (!ctx) return { ok: false, message: "Only admins, ticketing and finance manage suppliers." };
  if (supplierId !== null && !(typeof supplierId === "string" && UUID_RE.test(supplierId))) return { ok: false, message: "That supplier couldn't be found." };
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const form: SupplierForm = {
    name: text(r.name),
    type: SUPPLIER_TYPES.includes(r.type as SupplierType) ? (r.type as SupplierType) : "",
    iataCode: text(r.iataCode),
    email: text(r.email),
    phone: text(r.phone),
    paymentTermsDays: text(r.paymentTermsDays),
    notes: text(r.notes),
  };
  const problem = Object.values(validateSupplier(form)).find(Boolean);
  if (problem) return { ok: false, message: problem };
  const row = supplierRow(form);

  const { error } = supplierId
    ? await ctx.supabase.from("suppliers").update(row).eq("id", supplierId)
    : await ctx.supabase.from("suppliers").insert({ ...row, organization_id: ctx.orgId });
  if (error) return { ok: false, message: friendly(error, "save this supplier") };
  refresh();
  return { ok: true, message: supplierId ? `${row.name} updated.` : `${row.name} added.` };
}

export async function setSupplierActive(supplierId: unknown, active: unknown): Promise<SupplierResult> {
  const ctx = await managerContext();
  if (!ctx) return { ok: false, message: "Only admins, ticketing and finance manage suppliers." };
  if (!(typeof supplierId === "string" && UUID_RE.test(supplierId)) || typeof active !== "boolean") return { ok: false, message: "That supplier couldn't be found." };
  const { data, error } = await ctx.supabase.from("suppliers").update({ active }).eq("id", supplierId).select("name").maybeSingle();
  if (error || !data) return { ok: false, message: friendly(error, "change this supplier") };
  refresh();
  return { ok: true, message: active ? `${data.name} is active again.` : `${data.name} deactivated. Existing links stay; it can't be picked for new services.` };
}

function friendly(error: PostgrestError | null, action: string) {
  if (!error) return `Couldn't ${action}. Try again in a moment.`;
  if (error.code === "23505") return "A supplier with that name already exists.";
  if (/row-level security|permission denied for/i.test(error.message)) return `You don't have permission to ${action}.`;
  if (error.code === "23514") return "Some details weren't accepted. Check them and try again.";
  return `Couldn't ${action}. Try again in a moment.`;
}
