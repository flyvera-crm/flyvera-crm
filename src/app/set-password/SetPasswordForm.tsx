"use client";

import { useActionState } from "react";
import { setPassword, type PasswordState } from "@/lib/auth-actions";
import { Field, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";

const initialState: PasswordState = {};

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(setPassword, initialState);
  const describedBy = state.error ? "password-error" : undefined;

  return (
    <form action={formAction} className="mt-6 grid gap-4" noValidate>
      <Field id="password" label="New password" required>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={72}
          required
          className={inputClass(Boolean(state.error))}
          aria-describedby={describedBy}
        />
      </Field>
      <Field id="confirm" label="Repeat password" required>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass(Boolean(state.error))}
          aria-describedby={describedBy}
        />
      </Field>
      {state.error && (
        <p id="password-error" role="alert" className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-800 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : "Save password"}
        {!pending && <Icon name="arrowRight" size={16} className="text-gold-300" />}
      </button>
    </form>
  );
}
