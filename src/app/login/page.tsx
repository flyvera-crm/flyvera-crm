import type { Metadata } from "next";
import { Logo } from "@/components/layout/Logo";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

// Outside the (crm) folder, so it has no sidebar or top bar.
// src/proxy.ts sends signed-in users from here to /dashboard.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "";

  return (
    <div className="grid min-h-screen place-items-center bg-navy-950 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(14,165,233,0.18),transparent_70%)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-navy-950/40 sm:p-8">
          <h1 className="text-xl font-semibold text-navy-900">Sign in</h1>
          <p className="mt-1 text-sm text-navy-400">Use the email your agency admin invited.</p>
          <LoginForm nextPath={nextPath} />
        </div>
        <p className="mt-6 text-center text-xs text-navy-300">
          No account? Ask your agency admin for an invitation.
        </p>
      </div>
    </div>
  );
}
