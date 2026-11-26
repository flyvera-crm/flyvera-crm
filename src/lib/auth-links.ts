// Where email links (invitations, password resets) continue after /auth/confirm. Pure, unit-tested.
// These are in-app PATHS on purpose: the browser resolves them against the address it used
// (https://crm.flyvera.us in production, http://localhost:3000 in development). An absolute URL built
// on the server would use the server's own bind address behind a hosting proxy (e.g. 0.0.0.0:3000).
import type { EmailOtpType } from "@supabase/supabase-js";

/** Link types /auth/confirm accepts. */
export const EMAIL_LINK_TYPES: EmailOtpType[] = ["invite", "recovery", "signup", "email", "magiclink"];

/** Where a verified email link continues. */
export function confirmedPath(type: EmailOtpType) {
  if (type === "invite") return "/set-password?welcome=1";
  if (type === "recovery") return "/set-password";
  return "/dashboard";
}

/** Where an expired, used or malformed link goes. */
export const EXPIRED_LINK_PATH = "/forgot-password?expired=1";

/** True for a path inside this app ("/…"), never another site ("//evil.test", "/\evil", "https://…"). */
export function isInAppPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}
