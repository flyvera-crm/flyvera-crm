"use server";

// Sign-in / sign-out. Server Actions can write cookies, so the Supabase session
// is stored on the response and both server and browser see the login.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error?: string; email?: string };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter your email and password.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "invalid_credentials") {
      return { error: "That email and password don't match. Check both and try again.", email };
    }
    if (error.code === "email_not_confirmed") {
      return { error: "This email hasn't been confirmed yet. Ask your admin to confirm your account.", email };
    }
    return { error: "Sign-in isn't available right now. Try again in a moment.", email };
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Only allow returning to a page inside this app (blocks "//evil.com" style redirects). */
function safeNextPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "";
  const external = path.startsWith("//") || path.startsWith("/\\");
  return path.startsWith("/") && !external && !path.startsWith("/login") ? path : "/dashboard";
}
