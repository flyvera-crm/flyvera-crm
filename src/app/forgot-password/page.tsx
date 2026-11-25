import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };

// Signed-out only (src/proxy.ts). /auth/confirm sends expired or already-used email links here too.
export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { expired } = await searchParams;

  return (
    <div className="grid min-h-screen place-items-center bg-navy-950 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(14,165,233,0.18),transparent_70%)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-navy-950/40 sm:p-8">
          <h1 className="text-xl font-semibold text-navy-900">Reset your password</h1>
          {expired === "1" ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              That link has expired or was already used. Enter your email to get a new one. If you were invited, ask your admin to resend
              the invitation.
            </p>
          ) : (
            <p className="mt-1 text-sm text-navy-400">We&apos;ll email you a link to choose a new password.</p>
          )}
          <ForgotPasswordForm />
        </div>
        <p className="mt-6 text-center text-xs text-navy-300">
          <Link href="/login" className="text-sky-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
