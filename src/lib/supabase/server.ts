// Supabase client for Server Components, Server Actions and Route Handlers.
// Create a new one for every request — never share it between requests.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

export async function createClient() {
  // Read cookies first: it marks the page as per-request, so Next.js never
  // pre-renders a signed-in page (or a login redirect) at build time.
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can't set cookies. That's fine: src/proxy.ts refreshes
          // the session on every request. Server Actions can, so sign-in/out work here.
        }
      },
    },
  });
}
