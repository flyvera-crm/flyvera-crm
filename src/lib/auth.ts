// Who is signed in, and with which role. Server-side only (uses cookies).
// Call getCurrentUser() wherever a Server Component needs the user; React's
// cache() makes repeated calls in one request hit Supabase only once.
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole =
  | "admin"
  | "sales_manager"
  | "sales_agent"
  | "ticketing_agent"
  | "finance_manager"
  | "support_agent";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Agency Admin",
  sales_manager: "Sales Manager",
  sales_agent: "Sales Agent",
  ticketing_agent: "Ticketing Agent",
  finance_manager: "Finance Manager",
  support_agent: "Support Agent",
};

export type CurrentUser = {
  id: string;
  email: string;
  name: string; // full name, or the email when no name is set
  initials: string;
  /** null when the login has no active agency membership (not invited, or disabled). */
  membership: { organizationId: string; organizationName: string; role: AppRole; roleLabel: string } | null;
};

/** The signed-in user, or a redirect to /login. */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");

  const userId = claims.sub;
  const email = typeof claims.email === "string" ? claims.email : "";

  // Row Level Security lets users read their own profile and memberships.
  const [{ data: profile }, { data: member }] = await Promise.all([
    supabase.from("profiles").select("full_name, display_name").eq("id", userId).maybeSingle(),
    supabase
      .from("organization_members")
      .select("organization_id, role, organizations(name)")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  const name = profile?.full_name?.trim() || email;
  const role = member?.role as AppRole | undefined;
  const org = member?.organizations as { name?: string } | { name?: string }[] | null | undefined;
  const organizationName = (Array.isArray(org) ? org[0]?.name : org?.name) ?? "";

  return {
    id: userId,
    email,
    name,
    initials: initialsOf(profile?.full_name?.trim() || email),
    membership:
      member && role
        ? { organizationId: member.organization_id, organizationName, role, roleLabel: ROLE_LABELS[role] }
        : null,
  };
});

function initialsOf(text: string) {
  const base = text.includes("@") ? text.split("@")[0] : text;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : base.slice(0, 2);
  return letters.toUpperCase();
}
