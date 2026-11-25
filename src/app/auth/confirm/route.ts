// Email links land here: invitations and password resets.
// The Supabase email templates link to
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite   (or type=recovery)
// Verifying the one-time token signs the person in (session cookies are set on this response);
// accepting an invitation also confirms their email, which is when the database grants access
// (migration 19). Then they choose a password.
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["invite", "recovery", "signup", "email", "magiclink"];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const to = request.nextUrl.clone();
  to.search = "";

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      to.pathname = type === "invite" || type === "recovery" ? "/set-password" : "/dashboard";
      if (type === "invite") to.searchParams.set("welcome", "1");
      return NextResponse.redirect(to);
    }
  }

  // Expired, already used, or malformed.
  to.pathname = "/forgot-password";
  to.searchParams.set("expired", "1");
  return NextResponse.redirect(to);
}
