// Pure validation for the Add customer form (no React, no browser APIs),
// so the exact same rules can later run inside a Server Action.
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
  passportNumber: string;
  passportExpiry: string;
  tier: CustomerTier;
  agent: string;
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

/**
 * Returns blocking `errors` and non-blocking `warnings`.
 * `today` is passed in (YYYY-MM-DD) so results are predictable and testable.
 */
export function validateCustomer(values: CustomerFormValues, existing: Customer[], today: string) {
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

  // Passport (optional, but number and expiry go together)
  if (v.passportNumber && !PASSPORT_RE.test(v.passportNumber))
    errors.passportNumber = "Passport numbers are 6–9 letters or digits, no spaces.";
  if (v.passportNumber && !v.passportExpiry) errors.passportExpiry = "Add the passport expiry date.";
  if (!v.passportNumber && v.passportExpiry) errors.passportNumber = "Add the passport number too.";
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

/** Builds a clean Customer record from valid form values. */
export function toCustomer(values: CustomerFormValues, id: string, today: string): Customer {
  const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
  const optional = (s: string) => tidy(s) || undefined;
  return {
    id,
    name: `${tidy(values.firstName)} ${tidy(values.lastName)}`,
    email: values.email.trim().toLowerCase(),
    phone: tidy(values.phone),
    city: tidy(values.city),
    country: tidy(values.country),
    tier: values.tier,
    status: "Active",
    trips: 0,
    lifetimeValue: 0,
    lastTrip: null,
    favouriteDestination: tidy(values.favouriteDestination),
    agent: values.agent,
    joined: today,
    dateOfBirth: optional(values.dateOfBirth),
    nationality: optional(values.nationality),
    passportNumber: optional(values.passportNumber.toUpperCase()),
    passportExpiry: optional(values.passportExpiry),
    preferredContact: values.preferredContact,
    seatPreference: values.seatPreference,
    whatsappOptIn: values.whatsappOptIn,
    notes: optional(values.notes),
  };
}

/** Fills the form from an existing customer (for editing). */
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
    passportNumber: c.passportNumber ?? "",
    passportExpiry: c.passportExpiry ?? "",
    tier: c.tier,
    agent: c.agent,
    preferredContact: c.preferredContact ?? emptyCustomerForm.preferredContact,
    seatPreference: c.seatPreference ?? emptyCustomerForm.seatPreference,
    favouriteDestination: c.favouriteDestination,
    whatsappOptIn: c.whatsappOptIn ?? false,
    notes: c.notes ?? "",
  };
}

/** Applies edited form values to a customer, keeping ID, history and stats. */
export function applyCustomerEdits(existing: Customer, values: CustomerFormValues): Customer {
  const updated = toCustomer(values, existing.id, existing.joined);
  return {
    ...updated,
    status: existing.status,
    trips: existing.trips,
    lifetimeValue: existing.lifetimeValue,
    lastTrip: existing.lastTrip,
  };
}

/** CU-1024 → CU-1025 (based on the highest existing number). */
export function nextCustomerId(existing: Customer[]) {
  const max = existing.reduce((m, c) => Math.max(m, Number(c.id.replace(/\D/g, "")) || 0), 1000);
  return `CU-${max + 1}`;
}
