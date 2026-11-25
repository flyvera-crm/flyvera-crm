// Pure validation for the Add/Edit customer form (no React, no browser APIs).
// The same rules run in the browser (instant feedback) and in the Server Action
// (src/lib/actions/customers.ts) before anything is written to the database.
import type { ContactMethod, Customer, CustomerTier, SeatPreference } from "@/types/crm";

export type CustomerFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  city: string;
  country: string;
  passportNumber: string; // empty when editing = keep the stored number
  passportExpiry: string;
  passportIssuingCountry: string;
  tier: CustomerTier;
  agent: string; // the assigned agent's user id
  preferredContact: ContactMethod;
  seatPreference: SeatPreference;
  favouriteDestination: string;
  whatsappOptIn: boolean;
  notes: string;
};

export type FieldName = keyof CustomerFormValues;
export type Messages = Partial<Record<FieldName, string>>;

export const emptyCustomerForm: CustomerFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  nationality: "",
  city: "",
  country: "",
  passportNumber: "",
  passportExpiry: "",
  passportIssuingCountry: "",
  tier: "Standard",
  agent: "",
  preferredContact: "WhatsApp",
  seatPreference: "No preference",
  favouriteDestination: "",
  whatsappOptIn: false,
  notes: "",
};

export const NOTES_MAX = 500;

const NAME_RE = /^\p{L}[\p{L}\p{M}' .-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+\d{7,15}$/;
const PASSPORT_RE = /^[A-Z0-9]{6,9}$/;

/** "+44 (7700) 900-123" → "+447700900123" */
export function compactPhone(phone: string) {
  return phone.replace(/[\s().-]/g, "");
}

function addMonths(isoDate: string, months: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function yearsBetween(fromIso: string, toIso: string) {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}

export type ValidateOptions = {
  /** A passport is already on file: the number may be left empty (= keep it). */
  storedPassport?: boolean;
};

/**
 * Returns blocking `errors` and non-blocking `warnings`.
 * `today` is passed in (YYYY-MM-DD) so results are predictable and testable.
 * `existing` = other customers this user can see, for duplicate checks (the
 * database also rejects duplicates this user can't see).
 */
export function validateCustomer(
  values: CustomerFormValues,
  existing: Customer[],
  today: string,
  { storedPassport = false }: ValidateOptions = {},
) {
  const errors: Messages = {};
  const warnings: Messages = {};
  const v = {
    ...values,
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    email: values.email.trim().toLowerCase(),
    city: values.city.trim(),
    country: values.country.trim(),
    passportNumber: values.passportNumber.trim().toUpperCase(),
  };

  // Names
  for (const key of ["firstName", "lastName"] as const) {
    const label = key === "firstName" ? "First name" : "Last name";
    if (!v[key]) errors[key] = `${label} is required.`;
    else if (v[key].length > 50) errors[key] = `${label} must be 50 characters or fewer.`;
    else if (!NAME_RE.test(v[key])) errors[key] = `${label} can only contain letters, spaces, hyphens and apostrophes.`;
  }

  // Email (+ duplicate check)
  if (!v.email) errors.email = "Email is required.";
  else if (!EMAIL_RE.test(v.email)) errors.email = "Enter a valid email, e.g. name@example.com.";
  else {
    const dup = existing.find((c) => c.email.toLowerCase() === v.email);
    if (dup) errors.email = `Already used by ${dup.name} (${dup.id}).`;
  }

  // Phone (international format, needed for WhatsApp) + duplicate check
  const phone = compactPhone(values.phone.trim());
  if (!phone) errors.phone = "Phone number is required.";
  else if (!PHONE_RE.test(phone))
    errors.phone = "Use international format: + and country code, e.g. +44 7700 900123.";
  else {
    const dup = existing.find((c) => compactPhone(c.phone) === phone);
    if (dup) errors.phone = `Already used by ${dup.name} (${dup.id}).`;
  }

  // Date of birth (optional)
  if (v.dateOfBirth) {
    if (v.dateOfBirth >= today) errors.dateOfBirth = "Date of birth must be in the past.";
    else if (v.dateOfBirth < "1900-01-01") errors.dateOfBirth = "Please check the year.";
    else if (yearsBetween(v.dateOfBirth, today) < 18)
      warnings.dateOfBirth = "Under 18 — bookings may need a parent or guardian's consent.";
  }

  // Location
  if (!v.city) errors.city = "City is required.";
  if (!v.country) errors.country = "Country is required.";

  // Passport (optional, but number, expiry and issuing country go together)
  const hasPassport = Boolean(v.passportNumber) || storedPassport;
  if (v.passportNumber && !PASSPORT_RE.test(v.passportNumber))
    errors.passportNumber = "Passport numbers are 6–9 letters or digits, no spaces.";
  if (hasPassport && !v.passportExpiry) errors.passportExpiry = "Add the passport expiry date.";
  if (!hasPassport && v.passportExpiry) errors.passportNumber = "Add the passport number too.";
  if (hasPassport && !values.passportIssuingCountry.trim())
    errors.passportIssuingCountry = "Add the country that issued the passport.";
  if (v.passportExpiry) {
    if (v.passportExpiry <= today) errors.passportExpiry = "This passport has expired.";
    else if (v.passportExpiry < addMonths(today, 6))
      warnings.passportExpiry = "Expires within 6 months — many countries will refuse entry.";
  }

  // Account
  if (!v.agent) errors.agent = "Assign an agent.";
  if (values.preferredContact === "WhatsApp" && !values.whatsappOptIn)
    warnings.whatsappOptIn = "WhatsApp is the preferred contact, but the customer hasn't opted in yet.";
  if (values.notes.length > NOTES_MAX) errors.notes = `Notes must be ${NOTES_MAX} characters or fewer.`;

  return { errors, warnings };
}

/** Collapses runs of spaces and trims. */
export function tidy(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Fills the form from an existing customer (for editing). The passport number
 * stays empty: it's encrypted, and leaving it empty keeps the stored one.
 */
export function customerToFormValues(c: Customer): CustomerFormValues {
  const [firstName, ...rest] = c.name.split(" ");
  return {
    ...emptyCustomerForm,
    firstName,
    lastName: rest.join(" "),
    email: c.email,
    phone: c.phone,
    dateOfBirth: c.dateOfBirth ?? "",
    nationality: c.nationality ?? "",
    city: c.city,
    country: c.country,
    passportNumber: "",
    passportExpiry: c.passport?.expiry ?? "",
    passportIssuingCountry: c.passport?.issuingCountry ?? "",
    tier: c.tier,
    agent: c.agentId ?? "",
    preferredContact: c.preferredContact ?? emptyCustomerForm.preferredContact,
    seatPreference: c.seatPreference ?? emptyCustomerForm.seatPreference,
    favouriteDestination: c.favouriteDestination,
    whatsappOptIn: c.whatsappOptIn ?? false,
    notes: c.notes ?? "",
  };
}
