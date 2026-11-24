"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { Customer, Lead, LeadPriority } from "@/types/crm";
import type { AgentOption } from "@/lib/data/team";
import { LEAD_PRIORITIES, LEAD_SOURCES, LEAD_STAGES, TRIP_TYPES } from "@/config/lead-options";
import {
  emptyLeadForm,
  LEAD_NOTES_MAX,
  validateLead,
  type LeadField,
  type LeadFormValues,
  type LeadMessages,
} from "@/lib/lead-validation";
import { Field, FormSection, fieldA11y, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";

export const LEAD_FORM_ID = "lead-form";

const FIELD_ORDER: LeadField[] = [
  "name", "phone", "email", "source", "destination", "tripType", "departDate", "returnDate",
  "travellers", "budget", "stage", "priority", "agent", "nextFollowUp", "notes",
];

const priorityStyle: Record<LeadPriority, string> = {
  Hot: "border-rose-300 bg-rose-50 text-rose-700",
  Warm: "border-amber-300 bg-amber-50 text-amber-700",
  Cold: "border-navy-200 bg-navy-50 text-navy-600",
};

function SelectBox(props: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return (
    <div className="relative">
      <select {...rest} className={cn(inputClass(invalid, "h-11 appearance-none pr-9"), className)} />
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
    </div>
  );
}

/** What saving returned: nothing = success; otherwise a message and/or per-field errors. */
export type LeadSubmitOutcome = { message?: string; fieldErrors?: LeadMessages } | undefined;

export function LeadForm({
  mode,
  leadId,
  initialValues = emptyLeadForm,
  agentOptions,
  otherLeads,
  customers,
  today,
  onSubmit,
  onDirty,
}: {
  mode: "add" | "edit";
  /** The lead's code when editing; new leads get one when saved. */
  leadId: string | null;
  initialValues?: LeadFormValues;
  agentOptions: AgentOption[];
  otherLeads: Lead[];
  customers: Customer[];
  today: string;
  onSubmit: (values: LeadFormValues) => Promise<LeadSubmitOutcome>;
  onDirty: () => void;
}) {
  const [values, setValues] = useState<LeadFormValues>(initialValues);
  const [touched, setTouched] = useState<Partial<Record<LeadField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<LeadMessages>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const { errors, warnings } = useMemo(
    () => validateLead(values, otherLeads, customers, today),
    [values, otherLeads, customers, today],
  );
  const errorCount = Object.keys(errors).length;

  // Errors from the server show until the field changes.
  const show = (f: LeadField) => submitted || touched[f];
  const err = (f: LeadField) => (show(f) ? errors[f] : undefined) ?? serverErrors[f];
  const warn = (f: LeadField) => (show(f) ? warnings[f] : undefined);

  function set<K extends LeadField>(field: K, value: LeadFormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }));
    if (serverErrors[field])
      setServerErrors((current) => {
        const rest = { ...current };
        delete rest[field];
        return rest;
      });
    onDirty();
  }
  const touch = (f: LeadField) => () => setTouched((t) => (t[f] ? t : { ...t, [f]: true }));

  function bind(field: LeadField, hint?: string) {
    return {
      ...fieldA11y(field, { error: err(field), warning: warn(field), hint }),
      value: values[field],
      onChange: (e: { target: { value: string } }) => set(field, e.target.value as never),
      onBlur: touch(field),
      className: inputClass(!!err(field)),
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerMessage(null);
    const firstInvalid = FIELD_ORDER.find((f) => errors[f]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    const outcome = await onSubmit(values);
    if (!outcome) return;
    setServerErrors(outcome.fieldErrors ?? {});
    setServerMessage(outcome.message ?? null);
    const firstServerError = FIELD_ORDER.find((f) => outcome.fieldErrors?.[f]);
    if (firstServerError) document.getElementById(firstServerError)?.focus();
  }

  return (
    <form id={LEAD_FORM_ID} onSubmit={handleSubmit} noValidate>
      <div className="flex items-center justify-between gap-3 border-b border-navy-50 bg-canvas/70 px-5 py-3 text-xs text-navy-500 sm:px-7">
        <span>
          {mode === "edit" && leadId ? (
            <>
              Editing <span className="font-mono text-navy-700">{leadId}</span>
            </>
          ) : (
            "Gets a lead code when saved"
          )}
        </span>
        <span>
          <span className="text-rose-500">*</span> Required
        </span>
      </div>

      {submitted && errorCount > 0 && (
        <div role="alert" className="mx-5 mt-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700 sm:mx-7">
          <Icon name="alert" size={18} className="mt-px shrink-0" />
          <p>
            <span className="font-semibold">
              {errorCount} {errorCount === 1 ? "field needs" : "fields need"} attention.
            </span>{" "}
            Check the highlighted fields below.
          </p>
        </div>
      )}

      {serverMessage && !(submitted && errorCount > 0) && (
        <div role="alert" className="mx-5 mt-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700 sm:mx-7">
          <Icon name="alert" size={18} className="mt-px shrink-0" />
          <p className="font-semibold">{serverMessage}</p>
        </div>
      )}

      <FormSection title="Contact">
        <Field id="name" label="Full name" required error={err("name")} className="sm:col-span-2">
          <input {...bind("name")} autoComplete="name" placeholder="e.g. Nadia Rahman" />
        </Field>
        <Field id="phone" label="Mobile / WhatsApp" required error={err("phone")} warning={warn("phone")} hint="Include the country code.">
          <input {...bind("phone", "Include the country code.")} type="tel" inputMode="tel" autoComplete="tel" placeholder="+44 7700 900123" />
        </Field>
        <Field id="email" label="Email" error={err("email")}>
          <input {...bind("email")} type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" />
        </Field>
        <Field id="source" label="Where did they find us?" required className="sm:col-span-2">
          <SelectBox {...bind("source")}>
            {LEAD_SOURCES.map((s) => (
              <option key={s.value}>{s.value}</option>
            ))}
          </SelectBox>
        </Field>
      </FormSection>

      <FormSection title="Trip" description="Rough details are fine — they'll firm up as you talk.">
        <Field id="destination" label="Destination" required error={err("destination")}>
          <input {...bind("destination")} placeholder="e.g. Maldives" />
        </Field>
        <Field id="tripType" label="Trip type" required>
          <SelectBox {...bind("tripType")}>
            {TRIP_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </SelectBox>
        </Field>
        <Field id="departDate" label="Departure" error={err("departDate")}>
          <input {...bind("departDate")} type="date" />
        </Field>
        <Field id="returnDate" label="Return" error={err("returnDate")}>
          <input {...bind("returnDate")} type="date" min={values.departDate || undefined} />
        </Field>
        <Field id="travellers" label="Travellers" required error={err("travellers")}>
          <input {...bind("travellers")} type="number" inputMode="numeric" min={1} max={99} step={1} />
        </Field>
        <Field id="budget" label="Estimated budget (USD)" error={err("budget")}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy-400">$</span>
            <input {...bind("budget")} inputMode="numeric" placeholder="e.g. 4500" className={inputClass(!!err("budget"), "h-11 pl-7")} />
          </div>
        </Field>
      </FormSection>

      <FormSection title="Pipeline">
        <Field id="stage" label="Stage" required>
          <SelectBox {...bind("stage")}>
            {LEAD_STAGES.filter((s) => s.value !== "Lost" || values.stage === "Lost").map((s) => (
              <option key={s.value} value={s.value}>
                {s.value} — {s.hint}
              </option>
            ))}
          </SelectBox>
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-navy-700">Priority</legend>
          <div className="grid grid-cols-3 gap-2">
            {LEAD_PRIORITIES.map((p) => (
              <label
                key={p}
                className={cn(
                  "flex h-11 cursor-pointer items-center justify-center gap-1 rounded-xl border text-sm font-semibold transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-sky-brand/20",
                  values.priority === p ? priorityStyle[p] : "border-navy-100 text-navy-400 hover:bg-navy-50",
                )}
              >
                <input
                  type="radio"
                  name="priority"
                  id={values.priority === p ? "priority" : undefined}
                  value={p}
                  checked={values.priority === p}
                  onChange={() => set("priority", p)}
                  className="sr-only"
                />
                {p === "Hot" && <span aria-hidden="true">🔥</span>}
                {p}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="agent" label="Assigned agent" required error={err("agent")}>
          <SelectBox {...bind("agent")} invalid={!!err("agent")}>
            <option value="">{agentOptions.length ? "Choose an agent…" : "No agents available"}</option>
            {agentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field id="nextFollowUp" label="Next follow-up" warning={warn("nextFollowUp")}>
          <input {...bind("nextFollowUp")} type="date" />
        </Field>
        <Field
          id="notes"
          label="Notes"
          className="sm:col-span-2"
          error={err("notes")}
          hint={`${values.notes.length}/${LEAD_NOTES_MAX} characters`}
        >
          <textarea
            {...bind("notes", `${values.notes.length}/${LEAD_NOTES_MAX} characters`)}
            rows={3}
            placeholder="What are they looking for? Hotel style, must-haves, budget flexibility…"
            className={inputClass(!!err("notes"), "min-h-24 resize-y py-2.5")}
          />
        </Field>
      </FormSection>
    </form>
  );
}
