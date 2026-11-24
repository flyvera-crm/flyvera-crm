// Supabase client for Client Components (runs in the browser).
// The session lives in cookies shared with the server, so both sides see the same login.
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
