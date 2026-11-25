import type { Metadata } from "next";
import { Logo } from "@/components/layout/Logo";
import { getCurrentUser } from "@/lib/auth";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata: Metadata = { title: "Choose a password" };

// Reached from an invitation or password-reset email (via /auth/confirm, which signs the person in),
// or by a signed-in user changing their password. Logged-out visitors are sent to /login by src/proxy.ts.
export default async function SetPasswordPage({ searchParams }: PageProps<"/set-password">) {
  const [{ welcome }, user] = await Promise.all([searchParams, getCurrentUser()]);
  const isWelcome = welcome === "1";

  return (
    <div className="grid min-h-screen place-items-center bg-navy-950 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(14,165,233,0.18),transparent_70%)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-navy-950/40 sm:p-8">
          <h1 className="text-xl font-semibold text-navy-900">{isWelcome ? "Welcome to FLYVERA" : "Choose a new password"}</h1>
          <p className="mt-1 text-sm text-navy-400">
            {isWelcome && user.membership ? (
              <>
                You&apos;ve joined {user.membership.organizationName} as {user.membership.roleLabel}. Choose a password for{" "}
                <span className="font-medium text-navy-700">{user.email}</span>.
              </>
            ) : (
              <>
                For <span className="font-medium text-navy-700">{user.email}</span>. Use at least 10 characters.
              </>
            )}
          </p>
          <SetPasswordForm />
        </div>
      </div>
    </div>
  );
}
