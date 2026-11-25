// Supabase client with the SERVICE-ROLE key: it bypasses Row Level Security.
// Used for exactly two things, both only after the caller is confirmed to be an admin:
//   • sending invitation emails (auth.admin.inviteUserByEmail)
//   • removing the unaccepted login of a revoked invitation (auth.admin.deleteUser)
// Import it ONLY from Server Actions. The key is read from SUPABASE_SERVICE_ROLE_KEY
// (no NEXT_PUBLIC_ prefix, so Next.js never puts it in the browser bundle) and must
// never be committed — it lives in .env.local / the hosting provider's secrets.
import { createClient } from "@supabase/supabase-js";

/** null when the key isn't configured (inviting by email is then unavailable). */
export function createAdminClient() {
  if (typeof window !== "undefined") throw new Error("The admin client can only be used on the server.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
