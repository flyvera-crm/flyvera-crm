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

/* ── Passwords (invitations and "forgot password") ── */

export type PasswordState = { error?: string; sent?: boolean; email?: string };

const PASSWORD_MIN = 10; // also stated on the set-password page ("use server" files export only async functions)

/** Signed-in person (arrived from an invitation or reset email, or changing it) chooses a new password. */
export async function setPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < PASSWORD_MIN) return { error: `Use at least ${PASSWORD_MIN} characters.` };
  if (password.length > 72) return { error: "Use at most 72 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { error: "Choose a password different from your current one." };
    if (error.code === "weak_password") return { error: "That password is too easy to guess. Try a longer one." };
    if (error.status === 401 || error.code === "session_not_found") {
      return { error: "Your link has expired. Request a new one from the sign-in page." };
    }
    return { error: "Your password couldn't be saved. Try again in a moment." };
  }
  redirect("/dashboard");
}

/**
 * Sends a password-reset email. The answer is the same whether or not the address has an
 * account, so this can't be used to find out who works at the agency.
 */
export async function requestPasswordReset(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return { error: "Enter your email address.", email };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error && error.status === 429) return { error: "Too many requests. Wait a few minutes and try again.", email };
  return { sent: true, email };
}
