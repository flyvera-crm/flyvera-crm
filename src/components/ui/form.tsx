import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";

// Shared styles for text inputs, selects and textareas.
export function inputClass(invalid?: boolean, extra?: string) {
  return cn(
    "w-full rounded-xl border bg-white px-3 text-sm text-navy-900 transition placeholder:text-navy-300",
    "focus:outline-none focus:ring-4 disabled:bg-navy-50",
    invalid
      ? "border-rose-300 focus:border-rose-400 focus:ring-rose-500/15"
      : "border-navy-100 focus:border-sky-brand focus:ring-sky-brand/15",
    extra ?? "h-11",
  );
}

/** Accessibility props linking an input to its hint / error / warning text. */
export function fieldA11y(id: string, { error, warning, hint }: { error?: string; warning?: string; hint?: string }) {
  const describedBy = [error && `${id}-error`, !error && warning && `${id}-warning`, hint && `${id}-hint`]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    name: id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  } as const;
}

export function Field({
  id,
  label,
  required,
  hint,
  error,
  warning,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  warning?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-navy-700">
        {label}
        {required ? (
          <span className="ml-0.5 text-rose-500" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-navy-300">Optional</span>
        )}
      </label>
      {children}
      <FieldMessages id={id} hint={hint} error={error} warning={warning} />
    </div>
  );
}

export function FieldMessages({ id, hint, error, warning }: { id: string; hint?: string; error?: string; warning?: string }) {
  return (
    <>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-rose-600">
          <Icon name="alert" size={14} className="mt-px shrink-0" /> {error}
        </p>
      ) : warning ? (
        <p id={`${id}-warning`} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-amber-700">
          <Icon name="alert" size={14} className="mt-px shrink-0" /> {warning}
        </p>
      ) : null}
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-navy-400">
          {hint}
        </p>
      )}
    </>
  );
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-navy-50 px-5 py-6 first:border-t-0 sm:px-7">
      <legend className="sr-only">{title}</legend>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-navy-900" aria-hidden="true">
          {title}
        </h3>
        {description && <p className="mt-0.5 text-xs text-navy-400">{description}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
