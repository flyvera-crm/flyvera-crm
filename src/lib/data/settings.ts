// The signed-in user's agency settings (migration 20) and their own profile. Server-side; cached per request.
// Every member may read their agency's row; only admins change it (update_agency_settings()).
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { FALLBACK_SETTINGS, settingsFromRow, type AgencySettings } from "@/lib/settings-rules";

export const getAgencySettings = cache(async (): Promise<AgencySettings> => {
  const user = await getCurrentUser();
  const orgId = user.membership?.organizationId;
  if (!orgId) return FALLBACK_SETTINGS;
  const supabase = await createClient();
  const { data } = await supabase.from("organizations").select("name, base_currency, timezone, settings").eq("id", orgId).maybeSingle();
  return settingsFromRow(data);
});

export type MyProfile = { email: string; fullName: string; displayName: string; phone: string };

export const getMyProfile = cache(async (): Promise<MyProfile> => {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("full_name, display_name, phone").eq("id", user.id).maybeSingle();
  return { email: user.email, fullName: data?.full_name ?? "", displayName: data?.display_name ?? "", phone: data?.phone ?? "" };
});
