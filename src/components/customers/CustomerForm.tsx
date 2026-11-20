"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { Customer } from "@/types/crm";
import { AGENTS, CONTACT_METHODS, COUNTRIES, CUSTOMER_TIERS, SEAT_PREFERENCES } from "@/config/customer-options";
import {
  emptyCustomerForm,
  NOTES_MAX,
  validateCustomer,
  type CustomerFormValues,
  type FieldName,
} from "@/lib/customer-validation";
import { Field, FieldMessages, FormSection, fieldA11y, inputClass } from "@/components/ui/form";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/icons";
import { cn, initials } from "@/lib/format";

export const CUSTOMER_FORM_ID = "customer-form";

// Order used to jump to the first problem when saving.
const FIELD_ORDER: FieldName[] = [
  "firstName", "lastName", "email", "phone", "dateOfBirth", "nationality", "city", "country",
  "passportNumber", "passportExpiry", "tier", "agent", "preferredContact", "seatPreference",
  "favouriteDestination", "whatsappOptIn", "notes",
];

const contactIcon: Record<string, IconName> = { WhatsApp: "chat", Email: "document", Phone: "bell" };

/**
 * Used for both adding and editing a customer.
 * `existing` = the other customers, used for duplicate email/phone checks.
 */
export function CustomerForm({
  mode,
  customerId,
  initialValues = emptyCustomerForm,
  existing,
  today,
  onSubmit,
  onDirty,
}: {
  mode: "add" | "edit";
  customerId: string;
  initialValues?: CustomerFormValues;
  existing: Customer[];
  today: string;
  onSubmit: (values: CustomerFormValues) => void;
  onDirty: () => void;
}) {
  const [values, setValues] = useState<CustomerFormValues>(initialValues);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const { errors, warnings } = useMemo(() => validateCustomer(values, existing, today), [values, existing, today]);
  const errorCount = Object.keys(errors).length;

  // Messages appear once a field has been left (blurred) or the user tried to save.
  const show = (f: FieldName) => submitted || touched[f];
  const err = (f: FieldName) => (show(f) ? errors[f] : undefined);
  const warn = (f: FieldName) => (show(f) ? warnings[f] : undefined);

  function set<K extends FieldName>(field: K, value: CustomerFormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }));
    onDirty();
  }
  const touch = (f: FieldName) => () => setTouched((t) => (t[f] ? t : { ...t, [f]: true }));

  /** Props for a plain text-like input bound to `field`. */
  function bind(field: Exclude<FieldName, "whatsappOptIn">, hint?: string) {
    return {
      ...fieldA11y(field, { error: err(field), warning: warn(field), hint }),
      value: values[field] as string,
      onChange: (e: { target: { value: string } }) => set(field, e.target.value as never),
      onBlur: touch(field),
      className: inputClass(!!err(field)),
    };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const firstInvalid = FIELD_ORDER.find((f) => errors[f]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    onSubmit(values);
  }

  const previewName = `${values.firstName} ${values.lastName}`.trim();

  return (
    <form id={CUSTOMER_FORM_ID} onSubmit={handleSubmit} noValidate>
      {/* Live preview of the new profile */}
      <div className="flex items-center gap-4 border-b border-navy-50 bg-canvas/70 px-5 py-4 sm:px-7">
        <span
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-full text-sm font-semibold",
            values.tier === "Platinum" ? "bg-navy-900 text-gold-300 ring-2 ring-gold-500/50" : "bg-white text-navy-700 ring-1 ring-navy-100",
          )}
        >
          {previewName ? initials(previewName) : <Icon name="users" size={20} className="text-navy-300" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-navy-900">{previewName || "New customer"}</p>
          <p className="truncate text-xs text-navy-400">
            {mode === "add" ? "Will be saved as" : "Editing"} <span className="font-mono text-navy-600">{customerId}</span>
            {values.city.trim() && <> · {values.city.trim()}</>}
          </p>
        </div>
        <Badge tone={values.tier === "Platinum" ? "premium" : values.tier === "Gold" ? "gold" : values.tier === "Silver" ? "neutral" : "info"}>
          {values.tier}
        </Badge>
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

      <FormSection title="Personal details" description="As written in the passport.">
        <Field id="firstName" label="First name" required error={err("firstName")}>
          <input {...bind("firstName")} autoComplete="given-name" placeholder="e.g. Nadia" />
        </Field>
        <Field id="lastName" label="Last name" required error={err("lastName")}>
          <input {...bind("lastName")} autoComplete="family-name" placeholder="e.g. Rahman" />
        </Field>
        <Field id="email" label="Email" required error={err("email")}>
          <input {...bind("email")} type="email" autoComplete="email" inputMode="email" placeholder="name@example.com" />
        </Field>
        <Field id="phone" label="Mobile / WhatsApp" required error={err("phone")} hint="Include the country code, e.g. +44 7700 900123.">
          <input {...bind("phone", "Include the country code, e.g. +44 7700 900123.")} type="tel" autoComplete="tel" inputMode="tel" placeholder="+44 7700 900123" />
        </Field>
        <Field id="dateOfBirth" label="Date of birth" error={err("dateOfBirth")} warning={warn("dateOfBirth")}>
          <input {...bind("dateOfBirth")} type="date" autoComplete="bday" />
        </Field>
        <Field id="nationality" label="Nationality" error={err("nationality")}>
          <input {...bind("nationality")} list="country-options" autoComplete="off" placeholder="Start typing…" />
        </Field>
      </FormSection>

      <FormSection title="Location">
        <Field id="city" label="City" required error={err("city")}>
          <input {...bind("city")} autoComplete="address-level2" placeholder="e.g. Manchester" />
        </Field>
        <Field id="country" label="Country of residence" required error={err("country")}>
          <input {...bind("country")} list="country-options" autoComplete="country-name" placeholder="Start typing…" />
        </Field>
      </FormSection>

      <FormSection title="Travel document" description="Needed for ticketing. Add both, or leave both empty.">
        <Field id="passportNumber" label="Passport number" error={err("passportNumber")}>
          <input
            {...bind("passportNumber")}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 123456789"
            className={inputClass(!!err("passportNumber"), "h-11 font-mono uppercase placeholder:font-sans placeholder:normal-case")}
          />
        </Field>
        <Field id="passportExpiry" label="Passport expiry" error={err("passportExpiry")} warning={warn("passportExpiry")}>
          <input {...bind("passportExpiry")} type="date" />
        </Field>
      </FormSection>

      <FormSection title="Account & preferences">
        {/* Tier: radio "cards" */}
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-navy-700">Customer tier</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CUSTOMER_TIERS.map((t) => (
              <label
                key={t.value}
                className={cn(
                  "relative cursor-pointer rounded-xl border p-3 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-sky-brand/20",
                  values.tier === t.value
                    ? t.value === "Platinum"
                      ? "border-gold-500 bg-navy-900 text-white"
                      : "border-sky-brand bg-sky-brand-light/50"
                    : "border-navy-100 hover:border-navy-200 hover:bg-navy-50/50",
                )}
              >
                <input
                  type="radio"
                  name="tier"
                  id={t.value === values.tier ? "tier" : undefined}
                  value={t.value}
                  checked={values.tier === t.value}
                  onChange={() => set("tier", t.value)}
                  className="sr-only"
                />
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {t.value === "Platinum" && <Icon name="crown" size={14} className="text-gold-400" />}
                  {t.value}
                </span>
                <span className={cn("mt-0.5 block text-xs", values.tier === t.value && t.value === "Platinum" ? "text-navy-200" : "text-navy-400")}>
                  {t.hint}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field id="agent" label="Assigned agent" required error={err("agent")}>
          <div className="relative">
            <select {...bind("agent")} className={inputClass(!!err("agent"), "h-11 appearance-none pr-9")}>
              <option value="">Choose an agent…</option>
              {AGENTS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
          </div>
        </Field>

        <Field id="seatPreference" label="Seat preference">
          <div className="relative">
            <select {...bind("seatPreference")} className={inputClass(false, "h-11 appearance-none pr-9")}>
              {SEAT_PREFERENCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
          </div>
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-navy-700">Preferred contact</legend>
          <div className="flex gap-1 rounded-xl border border-navy-100 p-1">
            {CONTACT_METHODS.map((m) => (
              <label
                key={m}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-brand/40",
                  values.preferredContact === m ? "bg-navy-900 text-white" : "text-navy-500 hover:bg-navy-50",
                )}
              >
                <input
                  type="radio"
                  name="preferredContact"
                  value={m}
                  checked={values.preferredContact === m}
                  onChange={() => {
                    set("preferredContact", m);
                    touch("preferredContact")();
                  }}
                  className="sr-only"
                />
                <Icon name={contactIcon[m]} size={14} />
                {m}
              </label>
            ))}
          </div>
        </fieldset>

        <Field id="favouriteDestination" label="Favourite destination">
          <input {...bind("favouriteDestination")} placeholder="e.g. Maldives" />
        </Field>

        <div className="sm:col-span-2">
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition",
              values.whatsappOptIn ? "border-emerald-300 bg-emerald-50/60" : "border-navy-100 hover:bg-navy-50/50",
            )}
          >
            <input
              {...fieldA11y("whatsappOptIn", { warning: show("whatsappOptIn") || show("preferredContact") ? warnings.whatsappOptIn : undefined })}
              type="checkbox"
              checked={values.whatsappOptIn}
              onChange={(e) => {
                set("whatsappOptIn", e.target.checked);
                touch("whatsappOptIn")();
              }}
              className="mt-0.5 size-4 shrink-0 accent-navy-900"
            />
            <span className="text-sm">
              <span className="font-medium text-navy-900">Customer agrees to receive WhatsApp messages</span>
              <span className="block text-xs text-navy-400">Itineraries, e-tickets, reminders and offers.</span>
            </span>
          </label>
          <FieldMessages
            id="whatsappOptIn"
            warning={show("whatsappOptIn") || show("preferredContact") ? warnings.whatsappOptIn : undefined}
          />
        </div>

        <Field
          id="notes"
          label="Notes"
          className="sm:col-span-2"
          error={err("notes")}
          hint={`${values.notes.length}/${NOTES_MAX} characters`}
        >
          <textarea
            {...bind("notes", `${values.notes.length}/${NOTES_MAX} characters`)}
            rows={3}
            placeholder="Dietary needs, mobility assistance, frequent flyer numbers, special occasions…"
            className={inputClass(!!err("notes"), "min-h-24 resize-y py-2.5")}
          />
        </Field>
      </FormSection>

      <datalist id="country-options">
        {COUNTRIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </form>
  );
}
