// Next.js 16 "proxy" (formerly middleware): runs before each matching request.
// It keeps the Supabase login fresh and redirects logged-out visitors to /login.
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Every page except Next.js build files and static images/icons.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
