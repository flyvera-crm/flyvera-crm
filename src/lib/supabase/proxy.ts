// Runs before every page request (called from src/proxy.ts):
//  1. refreshes the Supabase login session and writes updated cookies to the response;
//  2. sends logged-out visitors to /login, and logged-in visitors away from /login.
//
// This is only a convenience redirect. The real protection is the database's
// Row Level Security: without a valid login, every query returns nothing.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

/** Only for signed-out visitors (signed-in users are sent to the dashboard). */
const PUBLIC_PATHS = ["/login", "/forgot-password"];
/** Open to everyone: email links (invitations, password resets) sign the person in here. */
const OPEN_PATHS = ["/auth/confirm"];

export async function updateSession(request: NextRequest) {
  const { url, key } = supabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Don't put code between createServerClient and getClaims(): getClaims() is what
  // validates the login and triggers a token refresh when needed.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  if (OPEN_PATHS.some((p) => path === p || path.startsWith(p + "/"))) return response;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!signedIn && !isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    if (path !== "/") to.searchParams.set("next", path + request.nextUrl.search);
    return withCookies(NextResponse.redirect(to), response);
  }

  if (signedIn && isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = "/dashboard";
    to.search = "";
    return withCookies(NextResponse.redirect(to), response);
  }

  return response;
}

// A redirect must carry any refreshed session cookies, or the user gets logged out.
function withCookies(redirect: NextResponse, from: NextResponse) {
  from.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}
