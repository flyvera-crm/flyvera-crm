"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/lib/auth-actions";
import { Field, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";

const initialState: SignInState = {};

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="mt-6 grid gap-4" noValidate>
      <input type="hidden" name="next" value={nextPath} />
      <Field id="email" label="Email" required>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email ?? ""}
          className={inputClass(Boolean(state.error))}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "login-error" : undefined}
        />
      </Field>
      <Field id="password" label="Password" required>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass(Boolean(state.error))}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "login-error" : undefined}
        />
      </Field>

      {state.error && (
        <p
          id="login-error"
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
        >
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-800 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Signing in…" : "Sign in"}
        {!pending && <Icon name="arrowRight" size={16} className="text-gold-300" />}
      </button>
    </form>
  );
}
