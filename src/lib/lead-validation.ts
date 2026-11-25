// Pure validation for the lead form (no React / browser APIs). The same rules run
// in the browser and in the Server Action (src/lib/actions/leads.ts) before saving.
import type { Customer, Lead, LeadPriority, LeadSource, LeadStage, TripType } from "@/types/crm";
import { compactPhone } from "@/lib/customer-validation";

export type LeadFormValues = {
  name: string;
  phone: string;
  email: string;
  source: LeadSource;
  destination: string;
  tripType: TripType;
  departDate: string;
  returnDate: string;
  travellers: string; // kept as text while typing
  budget: string;
  stage: LeadStage;
  priority: LeadPriority;
  agent: string; // the assigned agent's user id
  nextFollowUp: string;
  notes: string;
};

export type LeadField = keyof LeadFormValues;
export type LeadMessages = Partial<Record<LeadField, string>>;

export const emptyLeadForm: LeadFormValues = {
  name: "",
  phone: "",
  email: "",
  source: "WhatsApp",
  destination: "",
  tripType: "Holiday",
  departDate: "",
  returnDate: "",
  travellers: "2",
  budget: "",
  stage: "New",
  priority: "Warm",
  agent: "",
  nextFollowUp: "",
  notes: "",
};

export const LEAD_NOTES_MAX = 500;

const NAME_RE = /^\p{L}[\p{L}\p{M}' .-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+\d{7,15}$/;

/**
 * `errors` block saving; `warnings` are shown but allow saving.
 * `otherLeads` should exclude the lead being edited.
 */
export function validateLead(values: LeadFormValues, otherLeads: Lead[], customers: Customer[], today: string) {
  const errors: LeadMessages = {};
  const warnings: LeadMessages = {};
  const name = values.name.trim();
  const email = values.email.trim().toLowerCase();
  const phone = compactPhone(values.phone.trim());
  const isClosed = values.stage === "Won" || values.stage === "Lost";

  if (!name) errors.name = "Name is required.";
  else if (name.length > 80) errors.name = "Name must be 80 characters or fewer.";
  else if (!NAME_RE.test(name)) errors.name = "Name can only contain letters, spaces, hyphens and apostrophes.";

  if (!phone) errors.phone = "Phone number is required.";
  else if (!PHONE_RE.test(phone)) errors.phone = "Use international format: + and country code, e.g. +44 7700 900123.";
  else {
    // Repeat enquiries are normal, so these are warnings, not errors.
    const customer = customers.find((c) => compactPhone(c.phone) === phone);
    const openLead = otherLeads.find((l) => compactPhone(l.phone) === phone && l.stage !== "Won" && l.stage !== "Lost");
    if (openLead) warnings.phone = `Already an open lead: ${openLead.name} (${openLead.id}).`;
    else if (customer) warnings.phone = `Existing customer: ${customer.name} (${customer.id}).`;
  }

  if (email && !EMAIL_RE.test(email)) errors.email = "Enter a valid email, e.g. name@example.com.";

  if (!values.destination.trim()) errors.destination = "Where do they want to go?";
  else if (values.destination.trim().length > 60) errors.destination = "Keep the destination under 60 characters.";

  const travellers = Number(values.travellers);
  if (!values.travellers.trim()) errors.travellers = "How many people are travelling?";
  else if (!Number.isInteger(travellers) || travellers < 1 || travellers > 99) errors.travellers = "Enter a whole number from 1 to 99.";

  if (values.budget.trim()) {
    const budget = Number(values.budget.replace(/[,\s]/g, ""));
    if (!Number.isFinite(budget) || budget < 0) errors.budget = "Enter an amount, e.g. 4500.";
    else if (budget > 10_000_000) errors.budget = "That looks too high — please check the amount.";
  }

  if (values.departDate && values.departDate < today && !isClosed)
    errors.departDate = "Departure is in the past. Update it, or mark the lead Won/Lost.";
  if (values.returnDate && !values.departDate) errors.departDate = "Add the departure date too.";
  if (values.returnDate && values.departDate && values.returnDate < values.departDate)
    errors.returnDate = "Return must be on or after departure.";

  if (!values.agent) errors.agent = "Assign an agent.";

  if (values.nextFollowUp && values.nextFollowUp < today && !isClosed)
    warnings.nextFollowUp = "This follow-up date is already in the past.";
  if (!values.nextFollowUp && !isClosed) warnings.nextFollowUp = "Tip: set a follow-up date so this lead isn't forgotten.";

  if (values.notes.length > LEAD_NOTES_MAX) errors.notes = `Notes must be ${LEAD_NOTES_MAX} characters or fewer.`;

  return { errors, warnings };
}

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

/** The budget field as a number (commas and spaces allowed while typing); 0 when empty. */
export function parseBudget(text: string) {
  return text.trim() ? Math.round(Number(text.replace(/[,\s]/g, ""))) : 0;
}

export function leadToFormValues(l: Lead): LeadFormValues {
  return {
    name: l.name,
    phone: l.phone,
    email: l.email ?? "",
    source: l.source,
    destination: l.destination,
    tripType: l.tripType,
    departDate: l.departDate ?? "",
    returnDate: l.returnDate ?? "",
    travellers: String(l.travellers),
    budget: l.budget ? String(l.budget) : "",
    stage: l.stage,
    priority: l.priority,
    agent: l.agentId ?? "",
    nextFollowUp: l.nextFollowUp ?? "",
    notes: l.notes ?? "",
  };
}

/** Splits "Nour Al Haddad" → { firstName: "Nour", lastName: "Al Haddad" } for the customer form. */
export function splitName(name: string) {
  const [firstName, ...rest] = tidy(name).split(" ");
  return { firstName, lastName: rest.join(" ") };
}
