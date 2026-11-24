"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import type { MyProfile } from "@/lib/data/settings";
import { saveAgencySettings, saveMyProfile, type SettingsResult } from "@/lib/actions/settings";
import {
  formFromSettings,
  LIMITS,
  letterhead,
  PROFILE_MAX,
  validateAgencyForm,
  type AgencyForm,
  type AgencyProfile,
  type AgencySettings,
} from "@/lib/settings-rules";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, fieldA11y, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/format";
import { Letterhead, PaymentDetails } from "@/components/documents/Letterhead";

type Tab = "agency" | "profile";

export function SettingsWorkspace({ settings, profile, isAdmin }: { settings: AgencySettings; profile: MyProfile; isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>(isAdmin ? "agency" : "profile");
  const tabs: { id: Tab; label: string }[] = [...(isAdmin ? [{ id: "agency" as const, label: "Agency" }] : []), { id: "profile", label: "My profile" }];
  return (
    <div className="space-y-6">
      <div className="flex gap-1" role="tablist" aria-label="Settings sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              tab === t.id ? "bg-navy-900 text-white" : "text-navy-500 hover:bg-navy-50 hover:text-navy-900",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "agency" && isAdmin ? <AgencyTab settings={settings} /> : <ProfileTab profile={profile} />}
    </div>
  );
}

/* ─────────────── Agency (admins) ─────────────── */

const PROFILE_FIELDS: { key: keyof AgencyProfile; label: string; hint?: string; wide?: boolean; type?: string }[] = [
  { key: "legalName", label: "Legal name", hint: "As registered, if different from the trading name." },
  { key: "taxNumber", label: "Tax registration number (TRN / VAT)" },
  { key: "address", label: "Address", wide: true },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "website", label: "Website" },
  { key: "iataNumber", label: "IATA number" },
];
const BANK_FIELDS: { key: keyof AgencyProfile; label: string; wide?: boolean }[] = [
  { key: "bankName", label: "Bank name" },
  { key: "accountName", label: "Account name" },
  { key: "iban", label: "IBAN" },
  { key: "swift", label: "SWIFT / BIC" },
  { key: "paymentNote", label: "Payment note", wide: true },
];
const NUMBER_FIELDS: { key: keyof typeof LIMITS; unit: string; hint: string }[] = [
  { key: "quoteValidityDays", unit: "days", hint: "How long a new quotation stays valid." },
  { key: "defaultTaxRate", unit: "%", hint: "Pre-filled on new quotations." },
  { key: "lowMarginPercent", unit: "%", hint: "Margins below this are flagged on quotations and bookings." },
  { key: "depositDays", unit: "days after booking", hint: "Deposit due date on new bookings." },
  { key: "balanceDaysBeforeDeparture", unit: "days before departure", hint: "Balance due date on new bookings." },
  { key: "supplierDaysBeforeDeparture", unit: "days before departure", hint: "When suppliers should be paid." },
];

function AgencyTab({ settings }: { settings: AgencySettings }) {
  const toast = useToast();
  const [form, setForm] = useState<AgencyForm>(() => formFromSettings(settings));
  const [submitted, setSubmitted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();
  const errors = validateAgencyForm(form);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);
  const setProfile = (k: keyof AgencyProfile, v: string) => {
    setForm({ ...form, profile: { ...form.profile, [k]: v } });
    setDirty(true);
  };
  const setDefault = (k: keyof AgencyForm["defaults"], v: string) => {
    setForm({ ...form, defaults: { ...form.defaults, [k]: v } });
    setDirty(true);
  };
  const head = letterhead(form.name.trim() || settings.name, form.profile);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) {
      toast({ tone: "info", message: <p>Check the highlighted fields.</p> });
      return;
    }
    startSaving(async () => {
      const r: SettingsResult = await saveAgencySettings(form);
      toast({ tone: r.ok ? undefined : "info", message: <p>{r.message}</p> });
      if (r.ok) {
        setDirty(false);
        setSubmitted(false);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Agency profile" subtitle="Printed on quotations, invoices and receipts. Leave a field empty to leave it off." />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
            <Field id="agencyName" label="Trading name" required error={err("name")} className="sm:col-span-2">
              <input
                {...fieldA11y("agencyName", { error: err("name") })}
                value={form.name}
                maxLength={120}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  setDirty(true);
                }}
                className={inputClass(!!err("name"))}
              />
            </Field>
            {PROFILE_FIELDS.map((f) => (
              <TextField key={f.key} f={f} value={form.profile[f.key]} error={err(`profile.${f.key}`)} onChange={(v) => setProfile(f.key, v)} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Invoice payment details" subtitle="Shown under “How to pay” on invoices." />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
            {BANK_FIELDS.map((f) => (
              <TextField key={f.key} f={f} value={form.profile[f.key]} error={err(`profile.${f.key}`)} onChange={(v) => setProfile(f.key, v)} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Sales & booking defaults" subtitle="Used for new quotations, bookings and invoices. Existing ones keep their dates and terms." />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
            {NUMBER_FIELDS.map((f) => {
              const id = `def-${f.key}`;
              const error = err(`defaults.${f.key}`);
              const { min, max, label, decimals } = LIMITS[f.key];
              return (
                <Field key={f.key} id={id} label={label} required error={error} hint={`${f.hint} ${min}–${max}.`}>
                  <div className="relative">
                    <input
                      {...fieldA11y(id, { error, hint: `${f.hint} ${min}–${max}.` })}
                      inputMode={decimals ? "decimal" : "numeric"}
                      value={form.defaults[f.key]}
                      onChange={(e) => setDefault(f.key, e.target.value)}
                      className={inputClass(!!error, "pr-40")}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-navy-400">{f.unit}</span>
                  </div>
                </Field>
              );
            })}
            <TermsField id="quoteTerms" label="Quotation terms" value={form.defaults.quoteTerms} error={err("defaults.quoteTerms")} onChange={(v) => setDefault("quoteTerms", v)} />
            <TermsField
              id="invoiceTerms"
              label="Invoice terms"
              value={form.defaults.invoiceTerms}
              error={err("defaults.invoiceTerms")}
              onChange={(v) => setDefault("invoiceTerms", v)}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Currency & time zone" subtitle="Not editable here yet." />
          <dl className="grid grid-cols-1 gap-4 p-5 text-sm sm:grid-cols-2 sm:p-6">
            <div>
              <dt className="text-navy-500">Currency</dt>
              <dd className="font-medium text-navy-900">{settings.currency}</dd>
              <dd className="mt-1 text-xs text-navy-400">Changing it with existing payments would mix currencies, so it needs its own, planned change.</dd>
            </div>
            <div>
              <dt className="text-navy-500">Time zone</dt>
              <dd className="font-medium text-navy-900">{settings.timezone}</dd>
              <dd className="mt-1 text-xs text-navy-400">Dates follow each person&apos;s own device for now.</dd>
            </div>
          </dl>
        </Card>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
        <Card className="overflow-hidden">
          <div className="bg-navy-900 px-5 py-5 text-white">
            <Letterhead head={head} subtitle="Preview" />
          </div>
          <div className="p-4">
            <PaymentDetails head={head} />
            {!head.bank.length && !head.paymentNote && <p className="text-xs text-navy-400">Bank details will appear here on invoices.</p>}
          </div>
        </Card>
        <div className="rounded-xl border border-navy-100 bg-white p-4 text-xs text-navy-500">
          Issued invoices keep the details they were issued with. Changes apply to drafts and new invoices.
        </div>
        <button
          type="submit"
          disabled={saving || !dirty}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-3 text-sm font-semibold text-white hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="check" size={16} className="text-gold-300" /> {saving ? "Saving…" : dirty ? "Save settings" : "Saved"}
        </button>
      </aside>
    </form>
  );
}

function TextField({
  f,
  value,
  error,
  onChange,
}: {
  f: { key: keyof AgencyProfile; label: string; hint?: string; wide?: boolean; type?: string };
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const id = `p-${f.key}`;
  return (
    <Field id={id} label={f.label} error={error} hint={f.hint} className={f.wide ? "sm:col-span-2" : undefined}>
      <input
        {...fieldA11y(id, { error, hint: f.hint })}
        type={f.type ?? "text"}
        value={value}
        maxLength={PROFILE_MAX[f.key] + 10}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(!!error)}
      />
    </Field>
  );
}

function TermsField({ id, label, value, error, onChange }: { id: string; label: string; value: string; error?: string; onChange: (v: string) => void }) {
  const hint = "One term per line, up to 10 lines.";
  return (
    <Field id={id} label={label} required error={error} hint={hint} className="sm:col-span-2">
      <textarea
        {...fieldA11y(id, { error, hint })}
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(!!error, "py-2.5 leading-relaxed")}
      />
    </Field>
  );
}

/* ─────────────── My profile (everyone) ─────────────── */

function ProfileTab({ profile }: { profile: MyProfile }) {
  const toast = useToast();
  const [v, setV] = useState({ fullName: profile.fullName, displayName: profile.displayName, phone: profile.phone });
  const [saving, startSaving] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    startSaving(async () => {
      const r = await saveMyProfile(v);
      toast({ tone: r.ok ? undefined : "info", message: <p>{r.message}</p> });
    });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title="My profile" subtitle="How your name appears on customers, leads, quotations and bookings." />
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <Row label="Email">
          <p className="py-2.5 text-sm text-navy-700">{profile.email}</p>
        </Row>
        <Field id="fullName" label="Full name" required>
          <input id="fullName" value={v.fullName} maxLength={120} onChange={(e) => setV({ ...v, fullName: e.target.value })} className={inputClass(false)} />
        </Field>
        <Field id="displayName" label="Short name" hint="e.g. “Sara K.” — shown in lists.">
          <input
            {...fieldA11y("displayName", { hint: "e.g. “Sara K.” — shown in lists." })}
            value={v.displayName}
            maxLength={40}
            onChange={(e) => setV({ ...v, displayName: e.target.value })}
            className={inputClass(false)}
          />
        </Field>
        <Field id="phone" label="Phone" hint="With the country code, e.g. +971 50 123 4567.">
          <input
            {...fieldA11y("phone", { hint: "With the country code, e.g. +971 50 123 4567." })}
            type="tel"
            value={v.phone}
            onChange={(e) => setV({ ...v, phone: e.target.value })}
            className={inputClass(false)}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/set-password" className="text-sm font-medium text-sky-brand-dark hover:underline">
            Change password
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-navy-700">{label}</p>
      {children}
    </div>
  );
}
