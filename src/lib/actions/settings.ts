"use server";

// Settings (migration 20). Agency settings: admins only, saved through update_agency_settings(), which
// checks every value again. My profile: anyone, for their own row only (Row Level Security).
import { refresh } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formToDb, validateAgencyForm, type AgencyForm, PROFILE_KEYS, LIMITS } from "@/lib/settings-rules";

export type SettingsResult = { ok: true; message: string } | { ok: false; message: string };

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Rebuilds the form from untrusted input: only known fields, all as text. */
function readForm(raw: unknown): AgencyForm {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p = (r.profile && typeof r.profile === "object" ? r.profile : {}) as Record<string, unknown>;
  const d = (r.defaults && typeof r.defaults === "object" ? r.defaults : {}) as Record<string, unknown>;
  return {
    name: text(r.name),
    profile: Object.fromEntries(Object.keys(PROFILE_KEYS).map((k) => [k, text(p[k])])) as AgencyForm["profile"],
    defaults: {
      ...(Object.fromEntries(Object.keys(LIMITS).map((k) => [k, text(d[k])])) as Record<keyof typeof LIMITS, string>),
      quoteTerms: text(d.quoteTerms),
      invoiceTerms: text(d.invoiceTerms),
    },
  };
}

export async function saveAgencySettings(raw: unknown): Promise<SettingsResult> {
  const user = await getCurrentUser();
  if (user.membership?.role !== "admin") return { ok: false, message: "Only an admin can change the agency settings." };
  const form = readForm(raw);
  const problem = Object.values(validateAgencyForm(form)).find(Boolean);
  if (problem) return { ok: false, message: problem };
  const { name, profile, defaults } = formToDb(form);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_agency_settings", {
    p_organization_id: user.membership.organizationId,
    p_name: name,
    p_profile: profile,
    p_defaults: defaults,
  });
  if (error) return { ok: false, message: friendly(error, "save the settings") };
  refresh();
  return { ok: true, message: "Agency settings saved. New quotations, bookings and invoices use them from now on." };
}

export async function saveMyProfile(raw: unknown): Promise<SettingsResult> {
  const user = await getCurrentUser();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fullName = text(r.fullName).trim();
  const displayName = text(r.displayName).trim();
  const phone = text(r.phone).trim();
  if (fullName.length < 2 || fullName.length > 120) return { ok: false, message: "Enter your full name (2–120 characters)." };
  if (displayName.length > 40) return { ok: false, message: "Keep the short name under 40 characters." };
  // Same rule as the database: + and 7–15 digits, spaces / dots / dashes / brackets allowed.
  if (phone && !/^\+[0-9]{7,15}$/.test(phone.replace(/[\s().-]/g, ""))) {
    return { ok: false, message: "Enter your phone with the country code, e.g. +971 50 123 4567." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, display_name: displayName || null, phone: phone || null })
    .eq("id", user.id)
    .select("id");
  if (error) return { ok: false, message: friendly(error, "save your profile") };
  if (!data?.length) return { ok: false, message: "Your profile couldn't be saved. Sign out and in again, then try once more." };
  refresh();
  return { ok: true, message: "Profile saved." };
}

function friendly(error: PostgrestError, action: string) {
  if (/row-level security|permission denied for/i.test(error.message)) return `You don't have permission to ${action}.`;
  if (["P0001", "22023", "42501"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514") return "Some details weren't accepted. Check them and try again.";
  return `Couldn't ${action}. Try again in a moment.`;
}
