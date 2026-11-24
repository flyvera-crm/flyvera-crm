// Agency settings (migration 20): shape, built-in defaults, reading from the database row, validation.
// Pure (no React / server APIs) — shared by the Settings screen, the Server Action, documents and tests.
// The database function update_agency_settings() checks the same rules again.

export const DEFAULT_TERMS = [
  "Prices are per the items listed and subject to availability until booked.",
  "A 30% deposit confirms the booking; the balance is due 30 days before departure.",
  "Flight fares are only guaranteed once tickets are issued.",
  "Cancellation charges apply as per supplier policies.",
];

export type AgencyProfile = {
  legalName: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  taxNumber: string;
  iataNumber: string;
  bankName: string;
  accountName: string;
  iban: string;
  swift: string;
  paymentNote: string;
};

export type AgencyDefaults = {
  quoteValidityDays: number;
  defaultTaxRate: number;
  lowMarginPercent: number;
  depositDays: number;
  balanceDaysBeforeDeparture: number;
  supplierDaysBeforeDeparture: number;
  quoteTerms: string[];
  invoiceTerms: string[];
};

export type AgencySettings = {
  name: string;
  currency: string;
  timezone: string;
  profile: AgencyProfile;
  defaults: AgencyDefaults;
};

/** The values the app used before Settings existed — still used for anything not set. */
export const BUILT_IN_DEFAULTS: AgencyDefaults = {
  quoteValidityDays: 14,
  defaultTaxRate: 0,
  lowMarginPercent: 8,
  depositDays: 7,
  balanceDaysBeforeDeparture: 30,
  supplierDaysBeforeDeparture: 14,
  quoteTerms: DEFAULT_TERMS,
  invoiceTerms: DEFAULT_TERMS,
};

export const EMPTY_PROFILE: AgencyProfile = {
  legalName: "",
  address: "",
  city: "",
  country: "",
  phone: "",
  email: "",
  website: "",
  taxNumber: "",
  iataNumber: "",
  bankName: "",
  accountName: "",
  iban: "",
  swift: "",
  paymentNote: "",
};

export const FALLBACK_SETTINGS: AgencySettings = {
  name: "FLYVERA",
  currency: "USD",
  timezone: "UTC",
  profile: EMPTY_PROFILE,
  defaults: BUILT_IN_DEFAULTS,
};

/** Database key ↔ app key. */
export const PROFILE_KEYS: Record<keyof AgencyProfile, string> = {
  legalName: "legal_name",
  address: "address",
  city: "city",
  country: "country",
  phone: "phone",
  email: "email",
  website: "website",
  taxNumber: "tax_number",
  iataNumber: "iata_number",
  bankName: "bank_name",
  accountName: "account_name",
  iban: "iban",
  swift: "swift",
  paymentNote: "payment_note",
};

export const DEFAULT_KEYS: Record<keyof AgencyDefaults, string> = {
  quoteValidityDays: "quote_validity_days",
  defaultTaxRate: "default_tax_rate",
  lowMarginPercent: "low_margin_percent",
  depositDays: "deposit_days",
  balanceDaysBeforeDeparture: "balance_days_before_departure",
  supplierDaysBeforeDeparture: "supplier_days_before_departure",
  quoteTerms: "quote_terms",
  invoiceTerms: "invoice_terms",
};

/** Number limits (same as the database). */
export const LIMITS: Record<Exclude<keyof AgencyDefaults, "quoteTerms" | "invoiceTerms">, { min: number; max: number; label: string; decimals?: boolean }> = {
  quoteValidityDays: { min: 1, max: 90, label: "Quotation validity" },
  defaultTaxRate: { min: 0, max: 50, label: "Default tax", decimals: true },
  lowMarginPercent: { min: 0, max: 100, label: "Low-margin alert" },
  depositDays: { min: 0, max: 60, label: "Deposit due" },
  balanceDaysBeforeDeparture: { min: 0, max: 180, label: "Balance due" },
  supplierDaysBeforeDeparture: { min: 0, max: 90, label: "Supplier payment" },
};

export const PROFILE_MAX: Record<keyof AgencyProfile, number> = {
  legalName: 120,
  address: 200,
  city: 80,
  country: 80,
  phone: 30,
  email: 254,
  website: 120,
  taxNumber: 40,
  iataNumber: 20,
  bankName: 80,
  accountName: 120,
  iban: 42,
  swift: 11,
  paymentNote: 300,
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const terms = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, 10) : null;

/** Reads an organizations row; anything missing or invalid falls back to the built-in defaults. */
export function settingsFromRow(row: { name?: string | null; base_currency?: string | null; timezone?: string | null; settings?: unknown } | null): AgencySettings {
  if (!row) return FALLBACK_SETTINGS;
  const s = (row.settings && typeof row.settings === "object" ? row.settings : {}) as Record<string, unknown>;
  const p = (s.profile && typeof s.profile === "object" ? s.profile : {}) as Record<string, unknown>;
  const num = (key: keyof typeof LIMITS) => {
    const v = Number(s[DEFAULT_KEYS[key]]);
    const { min, max, decimals } = LIMITS[key];
    return Number.isFinite(v) && v >= min && v <= max && (decimals || Number.isInteger(v)) ? v : BUILT_IN_DEFAULTS[key];
  };
  const profile = Object.fromEntries(
    (Object.keys(PROFILE_KEYS) as (keyof AgencyProfile)[]).map((k) => [k, str(p[PROFILE_KEYS[k]])]),
  ) as AgencyProfile;
  const quoteTerms = terms(s.quote_terms);
  const invoiceTerms = terms(s.invoice_terms);
  return {
    name: str(row.name) || FALLBACK_SETTINGS.name,
    currency: str(row.base_currency) || "USD",
    timezone: str(row.timezone) || "UTC",
    profile,
    defaults: {
      quoteValidityDays: num("quoteValidityDays"),
      defaultTaxRate: num("defaultTaxRate"),
      lowMarginPercent: num("lowMarginPercent"),
      depositDays: num("depositDays"),
      balanceDaysBeforeDeparture: num("balanceDaysBeforeDeparture"),
      supplierDaysBeforeDeparture: num("supplierDaysBeforeDeparture"),
      quoteTerms: quoteTerms?.length ? quoteTerms : DEFAULT_TERMS,
      // Invoices fall back to the quotation terms, like the database's invoice copy does.
      invoiceTerms: invoiceTerms?.length ? invoiceTerms : quoteTerms?.length ? quoteTerms : DEFAULT_TERMS,
    },
  };
}

/* ── The Settings form ── */

export type AgencyForm = {
  name: string;
  profile: AgencyProfile;
  /** Numbers as typed; terms as one line per row. */
  defaults: Record<keyof typeof LIMITS, string> & { quoteTerms: string; invoiceTerms: string };
};

export function formFromSettings(s: AgencySettings): AgencyForm {
  const d = s.defaults;
  return {
    name: s.name,
    profile: { ...s.profile },
    defaults: {
      quoteValidityDays: String(d.quoteValidityDays),
      defaultTaxRate: String(d.defaultTaxRate),
      lowMarginPercent: String(d.lowMarginPercent),
      depositDays: String(d.depositDays),
      balanceDaysBeforeDeparture: String(d.balanceDaysBeforeDeparture),
      supplierDaysBeforeDeparture: String(d.supplierDaysBeforeDeparture),
      quoteTerms: d.quoteTerms.join("\n"),
      invoiceTerms: d.invoiceTerms.join("\n"),
    },
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export type AgencyErrors = Partial<Record<"name" | `profile.${keyof AgencyProfile}` | `defaults.${keyof AgencyForm["defaults"]}`, string>>;

export function validateAgencyForm(f: AgencyForm): AgencyErrors {
  const e: AgencyErrors = {};
  const name = f.name.trim();
  if (name.length < 2 || name.length > 120) e.name = "Enter the agency name (2–120 characters).";

  for (const k of Object.keys(PROFILE_MAX) as (keyof AgencyProfile)[]) {
    if (f.profile[k].trim().length > PROFILE_MAX[k]) e[`profile.${k}`] = `At most ${PROFILE_MAX[k]} characters.`;
  }
  const p = f.profile;
  if (p.email.trim() && !EMAIL_RE.test(p.email.trim())) e["profile.email"] = "Enter a valid email address.";
  if (p.phone.trim() && !/^\+?[0-9 ().-]{6,30}$/.test(p.phone.trim())) e["profile.phone"] = "Enter a valid phone number.";
  if (p.swift.trim() && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(p.swift.trim().toUpperCase())) e["profile.swift"] = "8 or 11 letters and digits.";
  const iban = p.iban.replace(/\s/g, "").toUpperCase();
  if (iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) e["profile.iban"] = "Country code, check digits, then the account.";

  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const { min, max, decimals, label } = LIMITS[k];
    const raw = f.defaults[k].trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) e[`defaults.${k}`] = `${label}: enter a number.`;
    else if (n < min || n > max) e[`defaults.${k}`] = `${label}: from ${min} to ${max}.`;
    else if (decimals ? Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 : !Number.isInteger(n)) {
      e[`defaults.${k}`] = decimals ? `${label}: at most 2 decimals.` : `${label}: a whole number.`;
    }
  }
  for (const k of ["quoteTerms", "invoiceTerms"] as const) {
    const l = lines(f.defaults[k]);
    if (l.length > 10) e[`defaults.${k}`] = "At most 10 lines.";
    else if (l.some((x) => x.length > 300)) e[`defaults.${k}`] = "Each line can be at most 300 characters.";
  }
  return e;
}

/** The form as the database function expects it (call only when validateAgencyForm found nothing). */
export function formToDb(f: AgencyForm) {
  const profile = Object.fromEntries(
    (Object.keys(PROFILE_KEYS) as (keyof AgencyProfile)[]).map((k) => [PROFILE_KEYS[k], f.profile[k].trim()]),
  );
  const defaults: Record<string, number | string[]> = {};
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) defaults[DEFAULT_KEYS[k]] = Number(f.defaults[k].trim());
  defaults.quote_terms = lines(f.defaults.quoteTerms);
  defaults.invoice_terms = lines(f.defaults.invoiceTerms);
  return { name: f.name.trim(), profile, defaults };
}

/* ── Documents ── */

/** Agency details as printed on documents: only lines that have something in them. */
export function letterhead(name: string, p: Partial<AgencyProfile>) {
  const join = (parts: (string | undefined)[], sep: string) => parts.map((x) => x?.trim()).filter(Boolean).join(sep);
  return {
    name,
    legalName: p.legalName?.trim() && p.legalName.trim() !== name ? p.legalName.trim() : "",
    lines: [
      join([p.address, p.city, p.country], ", "),
      join([p.phone, p.email, p.website], " · "),
      join([p.taxNumber ? `TRN ${p.taxNumber}` : "", p.iataNumber ? `IATA ${p.iataNumber}` : ""], " · "),
    ].filter(Boolean),
    bank: [
      p.bankName?.trim() ? `Bank: ${p.bankName.trim()}` : "",
      p.accountName?.trim() ? `Account name: ${p.accountName.trim()}` : "",
      p.iban?.trim() ? `IBAN: ${p.iban.trim()}` : "",
      p.swift?.trim() ? `SWIFT/BIC: ${p.swift.trim()}` : "",
    ].filter(Boolean),
    paymentNote: p.paymentNote?.trim() ?? "",
  };
}

/** The copy kept on an issued invoice (database keys), as profile fields. */
export function issuerToProfile(issuer: Record<string, unknown>): { name: string; profile: AgencyProfile; terms: string[] } {
  const profile = Object.fromEntries(
    (Object.keys(PROFILE_KEYS) as (keyof AgencyProfile)[]).map((k) => [k, str(issuer[PROFILE_KEYS[k]])]),
  ) as AgencyProfile;
  return { name: str(issuer.name), profile, terms: terms(issuer.terms) ?? [] };
}

/**
 * What an invoice prints: its frozen copy once issued (invoices.issuer), otherwise — drafts, and invoices
 * issued before migration 20 that haven't been backfilled — the agency's current details and invoice terms.
 */
export function invoiceSource(issuer: Record<string, unknown> | null | undefined, s: AgencySettings) {
  if (issuer) {
    const copy = issuerToProfile(issuer);
    return { name: copy.name || s.name, profile: copy.profile, terms: copy.terms.length ? copy.terms : s.defaults.invoiceTerms };
  }
  return { name: s.name, profile: s.profile, terms: s.defaults.invoiceTerms };
}
