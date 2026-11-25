"use server";

// Add / edit customers and reveal passport numbers.
// Server Actions are public endpoints: every input is re-checked here, and every
// write runs as the signed-in user, so Row Level Security has the final say.
import { refresh } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import type { ContactMethod, Customer, CustomerTier, SeatPreference } from "@/types/crm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  emptyCustomerForm,
  tidy,
  validateCustomer,
  type CustomerFormValues,
  type Messages,
} from "@/lib/customer-validation";
import { CUSTOMER_COLUMNS, mapCustomer, type CustomerRow } from "@/lib/data/customers";
import { CONTACT_METHODS, CUSTOMER_TIERS, SEAT_PREFERENCES } from "@/config/customer-options";

export type SaveCustomerResult =
  | { ok: true; customer: Customer; warning?: string }
  | { ok: false; message: string; fieldErrors?: Messages };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveCustomer(target: { dbId?: string }, raw: unknown): Promise<SaveCustomerResult> {
  const user = await getCurrentUser();
  if (!user.membership) return { ok: false, message: "Your login isn't linked to an agency yet. Ask your admin." };
  const orgId = user.membership.organizationId;
  const editing = typeof target?.dbId === "string";
  if (editing && !UUID_RE.test(target.dbId!)) return { ok: false, message: "That customer couldn't be found." };

  const values = cleanValues(raw);
  const supabase = await createClient();

  // When editing: the current record and its passport (RLS: only if this user may see them).
  let existing: { id: string; whatsapp_opt_in: boolean } | null = null;
  let storedPassport: { id: string; expiry_date: string; issuing_country: string } | null = null;
  if (editing) {
    const { data } = await supabase
      .from("customers")
      .select("id, whatsapp_opt_in")
      .eq("id", target.dbId!)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return { ok: false, message: "This customer no longer exists, or you can't edit them." };
    existing = data;
    const { data: doc } = await supabase
      .from("customer_travel_documents")
      .select("id, expiry_date, issuing_country")
      .eq("customer_id", data.id)
      .eq("document_type", "Passport")
      .eq("is_primary", true)
      .maybeSingle();
    storedPassport = doc;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { errors } = validateCustomer(values, [], today, { storedPassport: Boolean(storedPassport) });
  if (Object.keys(errors).length) {
    return { ok: false, message: "Some details need attention.", fieldErrors: errors };
  }

  const optional = (s: string) => tidy(s) || null;
  const row = {
    first_name: tidy(values.firstName),
    last_name: tidy(values.lastName),
    email: values.email.trim().toLowerCase() || null,
    phone: tidy(values.phone),
    city: tidy(values.city),
    country: tidy(values.country),
    nationality: optional(values.nationality),
    date_of_birth: values.dateOfBirth || null,
    tier: values.tier,
    preferred_contact: values.preferredContact,
    seat_preference: values.seatPreference,
    favourite_destination: optional(values.favouriteDestination),
    whatsapp_opt_in: values.whatsappOptIn,
    whatsapp_opt_in_at: values.whatsappOptIn
      ? existing?.whatsapp_opt_in
        ? undefined // already opted in: keep the original date
        : new Date().toISOString()
      : null,
    notes: optional(values.notes),
    assigned_to: values.agent,
  };

  const saved = editing
    ? await supabase.from("customers").update(row).eq("id", existing!.id).select("id").maybeSingle()
    : await supabase
        .from("customers")
        .insert({ ...row, organization_id: orgId })
        .select("id")
        .maybeSingle();

  if (saved.error || !saved.data) return dbFailure(saved.error);
  const customerId = saved.data.id as string;

  // Passport: a new number goes through the encrypting function; otherwise only expiry / country change.
  let warning: string | undefined;
  const issuing = tidy(values.passportIssuingCountry);
  if (values.passportNumber) {
    const { error } = await supabase.rpc("save_customer_travel_document", {
      p_customer_id: customerId,
      p_document_number: values.passportNumber,
      p_expiry_date: values.passportExpiry,
      p_issuing_country: issuing,
      p_document_type: "Passport",
      p_nationality: optional(values.nationality),
      p_issue_date: null,
      p_is_primary: true,
      p_document_id: storedPassport?.id ?? null,
    });
    if (error) warning = passportFailure(error);
  } else if (
    storedPassport &&
    (storedPassport.expiry_date !== values.passportExpiry || storedPassport.issuing_country !== issuing)
  ) {
    const { error } = await supabase
      .from("customer_travel_documents")
      .update({ expiry_date: values.passportExpiry, issuing_country: issuing })
      .eq("id", storedPassport.id);
    if (error) warning = passportFailure(error);
  }

  const customer = await loadCustomer(customerId, user);
  if (!customer) return { ok: false, message: "Saved, but the customer couldn't be reloaded. Refresh the page." };

  refresh(); // reload the layout's customer list for every open page
  return { ok: true, customer, warning };
}

/** Full passport number for an allowed role. The database logs every reveal in the audit trail. */
export async function revealPassport(documentId: unknown): Promise<{ ok: true; number: string } | { ok: false; message: string }> {
  if (typeof documentId !== "string" || !UUID_RE.test(documentId)) return { ok: false, message: "Document not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_customer_travel_document", { p_document_id: documentId });
  if (error) {
    return {
      ok: false,
      message: error.code === "42501" ? "You don't have access to this passport." : "The passport couldn't be shown. Try again.",
    };
  }
  return { ok: true, number: String(data ?? "") };
}

/* ─────────────────────────── helpers ─────────────────────────── */

/** Keeps only known fields with the right types (the browser can send anything). */
function cleanValues(raw: unknown): CustomerFormValues {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof CustomerFormValues) => (typeof r[k] === "string" ? (r[k] as string) : "");
  const pick = <T extends string>(k: keyof CustomerFormValues, allowed: readonly T[], fallback: T) =>
    allowed.includes(r[k] as T) ? (r[k] as T) : fallback;
  const agent = str("agent");
  return {
    ...emptyCustomerForm,
    firstName: str("firstName"),
    lastName: str("lastName"),
    email: str("email"),
    phone: str("phone"),
    dateOfBirth: str("dateOfBirth"),
    nationality: str("nationality"),
    city: str("city"),
    country: str("country"),
    passportNumber: str("passportNumber").trim().toUpperCase(),
    passportExpiry: str("passportExpiry"),
    passportIssuingCountry: str("passportIssuingCountry"),
    tier: pick<CustomerTier>("tier", CUSTOMER_TIERS.map((t) => t.value), "Standard"),
    agent: UUID_RE.test(agent) ? agent : "",
    preferredContact: pick<ContactMethod>("preferredContact", CONTACT_METHODS, "WhatsApp"),
    seatPreference: pick<SeatPreference>("seatPreference", SEAT_PREFERENCES, "No preference"),
    favouriteDestination: str("favouriteDestination"),
    whatsappOptIn: r.whatsappOptIn === true,
    notes: str("notes"),
  };
}

async function loadCustomer(id: string, user: { id: string; name: string }): Promise<Customer | null> {
  const supabase = await createClient();
  const { data: row } = await supabase.from("customers").select(CUSTOMER_COLUMNS).eq("id", id).maybeSingle<CustomerRow>();
  if (!row) return null;
  const [{ data: doc }, { data: agent }] = await Promise.all([
    supabase
      .from("customer_travel_documents")
      .select("id, customer_id, number_last4, expiry_date, issuing_country")
      .eq("customer_id", id)
      .eq("document_type", "Passport")
      .eq("is_primary", true)
      .maybeSingle(),
    row.assigned_to
      ? supabase.from("profiles").select("full_name, display_name").eq("id", row.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const agentName = !row.assigned_to
    ? "Unassigned"
    : agent?.display_name?.trim() || agent?.full_name?.trim() || (row.assigned_to === user.id ? user.name : "Unnamed team member");
  return mapCustomer(row, { agentName, passport: doc ?? undefined, statsHidden: false });
}

function dbFailure(error: PostgrestError | null): SaveCustomerResult {
  if (error?.code === "23505") {
    if (error.message.includes("customers_email_uidx"))
      return {
        ok: false,
        message: "This email is already used.",
        fieldErrors: { email: "Another customer in your agency already uses this email." },
      };
    if (error.message.includes("customers_phone_uidx"))
      return {
        ok: false,
        message: "This phone number is already used.",
        fieldErrors: { phone: "Another customer in your agency already uses this phone number." },
      };
  }
  if (!error || error.code === "42501" || error.code === "PGRST116" || /row-level security/i.test(error.message)) {
    return { ok: false, message: "You don't have permission to save this customer with these details." };
  }
  if (error.code === "23503") {
    return { ok: false, message: "The selected agent isn't an active member of your agency.", fieldErrors: { agent: "Choose another agent." } };
  }
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007") {
    return { ok: false, message: "Some details weren't accepted. Check the highlighted format rules and try again." };
  }
  return { ok: false, message: "The customer couldn't be saved. Try again in a moment." };
}

function passportFailure(error: PostgrestError) {
  if (/encryption key is missing/i.test(error.message))
    return "The customer was saved, but not the passport: the encryption key isn't set up in Supabase Vault yet.";
  if (error.code === "42501") return "The customer was saved, but you don't have access to change their passport.";
  return "The customer was saved, but the passport couldn't be saved. Try again from Edit profile.";
}
