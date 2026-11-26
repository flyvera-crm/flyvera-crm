// Email links land here: invitations and password resets.
// The Supabase email templates link to
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite   (or type=recovery)
// Verifying the one-time token signs the person in (session cookies are set on this response);
// accepting an invitation also confirms their email, which is when the database grants access
// (migration 19). Then they choose a password.
//
// Redirects use in-app PATHS (redirect() from next/navigation), never an absolute URL built from the
// request: behind a hosting proxy the server sees its own bind address (e.g. https://0.0.0.0:3000), so
// the browser must resolve the path against the address it actually used (https://crm.flyvera.us).
import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { confirmedPath, EMAIL_LINK_TYPES, EXPIRED_LINK_PATH } from "@/lib/auth-links";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  if (tokenHash && type && EMAIL_LINK_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    // redirect() throws to finish the request, so it stays outside any try/catch.
    if (!error) redirect(confirmedPath(type));
  }

  // Expired, already used, or malformed.
  redirect(EXPIRED_LINK_PATH);
}
