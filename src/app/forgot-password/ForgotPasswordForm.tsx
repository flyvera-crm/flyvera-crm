"use client";

import { useActionState } from "react";
import { requestPasswordReset, type PasswordState } from "@/lib/auth-actions";
import { Field, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";

const initialState: PasswordState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.sent) {
    return (
      <p role="status" className="mt-6 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
        <Icon name="check" size={16} className="mt-0.5 shrink-0" />
        If {state.email} has an account, a reset link is on its way. Check your inbox (and spam folder).
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-6 grid gap-4" noValidate>
      <Field id="email" label="Email" required>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email ?? ""}
          className={inputClass(Boolean(state.error))}
          aria-describedby={state.error ? "reset-error" : undefined}
        />
      </Field>
      {state.error && (
        <p id="reset-error" role="alert" className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex h-11 items-center justify-center rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-800 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
