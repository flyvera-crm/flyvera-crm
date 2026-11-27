"use server";

// Ticketing changes on a booking. Server Actions are public endpoints: every input is
// re-checked here (src/lib/ticketing-rules.ts) and every write runs as the signed-in user,
// so Row Level Security has the final say. Tickets go through the database functions
// issue_ticket() / change_ticket_status() (migration 16), which keep their history auditable.
import { refresh } from "next/cache";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { storeLocalTime } from "@/lib/data/ticketing";
import {
  CABIN_CLASSES,
  cleanTicketNumber,
  DOCUMENT_KINDS,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_TYPES,
  PASSENGER_TYPES,
  PNR_PROVIDERS,
  PNR_STATUSES,
  SEGMENT_STATUSES,
  TICKET_CHANGES,
  validatePassenger,
  validatePassport,
  validatePnr,
  validateSegment,
  validateTicket,
  validateTicketChange,
  validateVerification,
  type PassengerFormValues,
  type PassportFormValues,
  type PnrFormValues,
  type SegmentFormValues,
  type TicketFormValues,
  type VerifyPnrValues,
} from "@/lib/ticketing-rules";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const today = () => new Date().toISOString().slice(0, 10);
const str = (r: Record<string, unknown>, k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
const obj = (raw: unknown) => (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T) => (allowed.includes(v as T) ? (v as T) : fallback);
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const first = (errors: Record<string, string | undefined>) => Object.values(errors).find(Boolean);

/* ─────────────────────────── passengers ─────────────────────────── */

export async function savePassenger(bookingDbId: unknown, passengerDbId: unknown, raw: unknown): Promise<ActionResult> {
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  const editing = passengerDbId !== null && passengerDbId !== undefined;
  if (editing && !isId(passengerDbId)) return { ok: false, message: "That passenger couldn't be found." };

  const r = obj(raw);
  const v: PassengerFormValues = {
    type: pick(r.type, PASSENGER_TYPES, "Adult"),
    title: str(r, "title"),
    firstName: str(r, "firstName"),
    lastName: str(r, "lastName"),
    dateOfBirth: str(r, "dateOfBirth"),
    gender: pick(r.gender, ["", "F", "M", "X"] as const, ""),
    nationality: str(r, "nationality"),
    frequentFlyer: str(r, "frequentFlyer"),
    meal: str(r, "meal"),
    assistance: str(r, "assistance"),
    isLead: r.isLead === true,
    customerCode: str(r, "customerCode"),
  };
  const problem = first(validatePassenger(v, today()));
  if (problem) return { ok: false, message: problem };

  let customerId: string | null = null;
  if (v.customerCode) {
    const { data } = await supabase.from("customers").select("id").eq("organization_id", orgId).eq("code", v.customerCode).maybeSingle();
    if (!data) return { ok: false, message: `Customer ${v.customerCode} isn't available to you.` };
    customerId = data.id as string;
  }

  const row = {
    customer_id: customerId,
    passenger_type: v.type,
    title: v.title || null,
    first_name: tidy(v.firstName),
    last_name: tidy(v.lastName),
    date_of_birth: v.dateOfBirth || null,
    gender: v.gender || null,
    nationality: tidy(v.nationality) || null,
    frequent_flyer: tidy(v.frequentFlyer) || null,
    meal_preference: tidy(v.meal) || null,
    special_assistance: v.assistance.trim() || null,
    is_lead_passenger: v.isLead,
  };

  // Only one lead passenger per booking: hand the role over first.
  if (v.isLead) {
    let others = supabase.from("passengers").update({ is_lead_passenger: false }).eq("booking_id", booking.id).eq("is_lead_passenger", true);
    if (editing) others = others.neq("id", passengerDbId as string);
    await others;
  }

  const saved = editing
    ? await supabase.from("passengers").update(row).eq("id", passengerDbId as string).eq("booking_id", booking.id).select("id").maybeSingle()
    : await supabase.from("passengers").insert({ ...row, organization_id: orgId, booking_id: booking.id }).select("id").maybeSingle();
  if (saved.error || !saved.data) return { ok: false, message: friendly(saved.error, "save this passenger") };

  if (!editing) await addEvent(supabase, orgId, booking.id, `Passenger ${row.first_name} ${row.last_name} added`);
  refresh();
  return { ok: true };
}

/** Removes a passenger who has no tickets (tickets keep their passenger — the database refuses otherwise). */
export async function removePassenger(bookingDbId: unknown, passengerDbId: unknown): Promise<ActionResult> {
  if (!isId(passengerDbId)) return { ok: false, message: "That passenger couldn't be found." };
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  const { data: p } = await supabase.from("passengers").select("first_name, last_name").eq("id", passengerDbId).eq("booking_id", booking.id).maybeSingle();
  if (!p) return { ok: false, message: "That passenger isn't on this booking." };
  const { data, error } = await supabase.from("passengers").delete().eq("id", passengerDbId).select("id").maybeSingle();
  if (error?.code === "23503") return { ok: false, message: "This passenger has tickets, so they stay on the booking. Void the tickets instead." };
  if (error || !data) return { ok: false, message: friendly(error, "remove this passenger") };
  await addEvent(supabase, orgId, booking.id, `Passenger ${p.first_name} ${p.last_name} removed`);
  refresh();
  return { ok: true };
}

/** Sets the passenger's travel document (encrypted by the database; only the last 4 characters are kept readable). */
export async function setPassengerPassport(passengerDbId: unknown, raw: unknown): Promise<ActionResult> {
  if (!isId(passengerDbId)) return { ok: false, message: "That passenger couldn't be found." };
  const r = obj(raw);
  const v: PassportFormValues = {
    documentType: pick(r.documentType, DOCUMENT_TYPES, "Passport"),
    number: str(r, "number"),
    expiry: str(r, "expiry"),
    issuingCountry: str(r, "issuingCountry"),
  };
  const problem = first(validatePassport(v, today()));
  if (problem) return { ok: false, message: problem };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_passenger_document", {
    p_passenger_id: passengerDbId,
    p_document_number: v.number,
    p_expiry_date: v.expiry,
    p_issuing_country: tidy(v.issuingCountry),
    p_document_type: v.documentType,
  });
  if (error) return { ok: false, message: friendly(error, "save this document") };
  refresh();
  return { ok: true };
}

/** Copies the customer's saved passport onto the passenger without ever showing the number. */
export async function copyCustomerPassport(passengerDbId: unknown, customerCode: unknown): Promise<ActionResult> {
  if (!isId(passengerDbId) || typeof customerCode !== "string" || !/^CU-\d+$/.test(customerCode))
    return { ok: false, message: "Link the passenger to a customer first." };
  const user = await getCurrentUser();
  if (!user.membership) return { ok: false, message: "Your login isn't linked to an agency yet." };
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("organization_id", user.membership.organizationId)
    .eq("code", customerCode)
    .maybeSingle();
  const { data: doc } = customer
    ? await supabase
        .from("customer_travel_documents")
        .select("id")
        .eq("customer_id", customer.id)
        .eq("document_type", "Passport")
        .eq("is_primary", true)
        .maybeSingle()
    : { data: null };
  if (!doc) return { ok: false, message: `${customerCode} has no saved passport you can use. Enter it instead.` };
  const { error } = await supabase.rpc("copy_customer_document_to_passenger", { p_passenger_id: passengerDbId, p_document_id: doc.id });
  if (error) return { ok: false, message: friendly(error, "copy the passport") };
  refresh();
  return { ok: true };
}

/** The full document number for an allowed role. The database logs every reveal in the audit trail. */
export async function revealPassengerPassport(passengerDbId: unknown): Promise<{ ok: true; number: string } | { ok: false; message: string }> {
  if (!isId(passengerDbId)) return { ok: false, message: "That passenger couldn't be found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_passenger_document", { p_passenger_id: passengerDbId });
  if (error) return { ok: false, message: friendly(error, "show this document") };
  return { ok: true, number: String(data ?? "") };
}

/* ─────────────────────────── reservations & flights ─────────────────────────── */

export async function savePnr(bookingDbId: unknown, pnrDbId: unknown, raw: unknown): Promise<ActionResult> {
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  const editing = pnrDbId !== null && pnrDbId !== undefined;
  if (editing && !isId(pnrDbId)) return { ok: false, message: "That reservation couldn't be found." };
  const r = obj(raw);
  const v: PnrFormValues = {
    recordLocator: str(r, "recordLocator"),
    airlineLocator: str(r, "airlineLocator"),
    airline: str(r, "airline"),
    provider: pick(r.provider, PNR_PROVIDERS, "Manual"),
    status: pick(r.status, PNR_STATUSES, "Active"),
    ticketingDeadline: str(r, "ticketingDeadline"),
  };
  const problem = first(validatePnr(v));
  if (problem) return { ok: false, message: problem };

  const row = {
    record_locator: v.recordLocator.trim().toUpperCase(),
    airline_locator: v.airlineLocator.trim().toUpperCase() || null,
    airline: v.airline.trim().toUpperCase() || null,
    provider: v.provider,
    status: v.status,
    ticketing_deadline: v.ticketingDeadline ? storeLocalTime(v.ticketingDeadline) : null,
  };
  const saved = editing
    ? await supabase.from("pnr_records").update(row).eq("id", pnrDbId as string).eq("booking_id", booking.id).select("id").maybeSingle()
    : await supabase.from("pnr_records").insert({ ...row, organization_id: orgId, booking_id: booking.id }).select("id").maybeSingle();
  if (saved.error?.code === "23505") return { ok: false, message: `PNR ${row.record_locator} is already recorded for this provider.` };
  if (saved.error || !saved.data) return { ok: false, message: friendly(saved.error, "save this reservation") };
  await addEvent(supabase, orgId, booking.id, editing ? `PNR ${row.record_locator} updated (${row.status})` : `PNR ${row.record_locator} added (${row.provider})`);
  refresh();
  return { ok: true };
}

/**
 * Records the result of a manual PNR check (with the airline or consolidator). The database function
 * verify_pnr() (migration 23) stamps who and when, writes the timeline line and is audited; only admins
 * and ticketing agents may use it. Verification is separate from the PNR's status and from tickets.
 */
export async function verifyPnr(bookingDbId: unknown, pnrDbId: unknown, raw: unknown): Promise<ActionResult> {
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, booking } = ctx;
  if (!isId(pnrDbId)) return { ok: false, message: "That reservation couldn't be found." };
  const r = obj(raw);
  const v: VerifyPnrValues = {
    status: r.status === "Verified" || r.status === "Not verified" ? r.status : "",
    notes: str(r, "notes"),
  };
  const problem = first(validateVerification(v));
  if (problem) return { ok: false, message: problem };

  // The PNR must belong to this booking (the database function checks the role and the agency).
  const { data: pnr } = await supabase.from("pnr_records").select("id").eq("id", pnrDbId).eq("booking_id", booking.id).maybeSingle();
  if (!pnr) return { ok: false, message: "That reservation couldn't be found on this booking." };

  const { error } = await supabase.rpc("verify_pnr", { p_pnr_id: pnr.id, p_status: v.status, p_notes: v.notes.trim() || null });
  if (error) return { ok: false, message: friendly(error, "verify this reservation") };
  refresh();
  return { ok: true };
}

export async function saveSegment(bookingDbId: unknown, segmentDbId: unknown, raw: unknown): Promise<ActionResult> {
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  const editing = segmentDbId !== null && segmentDbId !== undefined;
  if (editing && !isId(segmentDbId)) return { ok: false, message: "That flight couldn't be found." };
  const r = obj(raw);
  const v: SegmentFormValues = {
    pnrId: str(r, "pnrId"),
    carrier: str(r, "carrier"),
    flightNumber: str(r, "flightNumber"),
    operatingCarrier: str(r, "operatingCarrier"),
    origin: str(r, "origin"),
    destination: str(r, "destination"),
    departsAt: str(r, "departsAt"),
    arrivesAt: str(r, "arrivesAt"),
    cabin: pick(r.cabin, CABIN_CLASSES, "Economy"),
    bookingClass: str(r, "bookingClass"),
    status: pick(r.status, SEGMENT_STATUSES, "Confirmed"),
  };
  const problem = first(validateSegment(v));
  if (problem) return { ok: false, message: problem };
  if (v.pnrId && !isId(v.pnrId)) return { ok: false, message: "Choose the reservation again." };

  const up = (s: string) => s.trim().toUpperCase();
  const row = {
    pnr_id: v.pnrId || null,
    marketing_carrier: up(v.carrier),
    flight_number: up(v.flightNumber),
    operating_carrier: up(v.operatingCarrier) || null,
    origin: up(v.origin),
    destination: up(v.destination),
    departs_at: storeLocalTime(v.departsAt),
    arrives_at: storeLocalTime(v.arrivesAt),
    cabin: v.cabin,
    booking_class: up(v.bookingClass) || null,
    status: v.status,
  };

  let saved;
  if (editing) {
    saved = await supabase.from("booking_segments").update(row).eq("id", segmentDbId as string).eq("booking_id", booking.id).select("id").maybeSingle();
  } else {
    const { data: last } = await supabase
      .from("booking_segments")
      .select("segment_no")
      .eq("booking_id", booking.id)
      .order("segment_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    saved = await supabase
      .from("booking_segments")
      .insert({ ...row, organization_id: orgId, booking_id: booking.id, segment_no: (last?.segment_no ?? 0) + 1 })
      .select("id")
      .maybeSingle();
  }
  if (saved.error || !saved.data) return { ok: false, message: friendly(saved.error, "save this flight") };
  if (!editing) await addEvent(supabase, orgId, booking.id, `Flight ${row.marketing_carrier}${row.flight_number} ${row.origin}→${row.destination} added`);
  refresh();
  return { ok: true };
}

export async function removeSegment(bookingDbId: unknown, segmentDbId: unknown): Promise<ActionResult> {
  if (!isId(segmentDbId)) return { ok: false, message: "That flight couldn't be found." };
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  const { data, error } = await supabase
    .from("booking_segments")
    .delete()
    .eq("id", segmentDbId)
    .eq("booking_id", booking.id)
    .select("marketing_carrier, flight_number, origin, destination")
    .maybeSingle();
  if (error || !data) return { ok: false, message: friendly(error, "remove this flight") };
  await addEvent(supabase, orgId, booking.id, `Flight ${data.marketing_carrier}${data.flight_number} ${data.origin}→${data.destination} removed`);
  refresh();
  return { ok: true };
}

/* ─────────────────────────── tickets ─────────────────────────── */

/**
 * Records a ticket that the airline / GDS has issued. Requires the agent's explicit confirmation
 * and goes through issue_ticket() (migration 16): 13-digit number, confirmed booking, active PNR
 * on the same booking, passenger on the same booking; timeline line + audit entry.
 */
export async function issueTicket(bookingDbId: unknown, raw: unknown): Promise<ActionResult> {
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, booking } = ctx;
  const r = obj(raw);
  const v: TicketFormValues = {
    passengerId: str(r, "passengerId"),
    pnrId: str(r, "pnrId"),
    ticketNumber: str(r, "ticketNumber"),
    airline: str(r, "airline"),
    baseFare: str(r, "baseFare"),
    taxes: str(r, "taxes"),
    issuedOn: str(r, "issuedOn"),
    supplierReference: str(r, "supplierReference"),
    confirmed: r.confirmed === true,
  };
  const problem = first(validateTicket(v, today(), booking.created));
  if (problem) return { ok: false, message: problem };
  if (!isId(v.passengerId) || !isId(v.pnrId)) return { ok: false, message: "Choose the passenger and reservation again." };

  const issuedAt = v.issuedOn === today() ? new Date().toISOString() : `${v.issuedOn}T12:00:00Z`;
  const { error } = await supabase.rpc("issue_ticket", {
    p_booking_id: booking.id,
    p_passenger_id: v.passengerId,
    p_pnr_id: v.pnrId,
    p_ticket_number: cleanTicketNumber(v.ticketNumber),
    p_issuing_airline: v.airline.trim().toUpperCase(),
    p_base_fare: Number(v.baseFare.replace(/[,\s$]/g, "")),
    p_taxes: v.taxes.trim() ? Number(v.taxes.replace(/[,\s$]/g, "")) : 0,
    p_issued_at: issuedAt,
    // The database records the source as "Manual from supplier document" (staff never choose it).
    p_supplier_reference: v.supplierReference.trim() || null,
  });
  if (error?.code === "23505") return { ok: false, message: "This ticket number is already recorded." };
  if (error) return { ok: false, message: friendly(error, "record this ticket") };
  refresh();
  return { ok: true };
}

/** Void, refund or exchange a ticket, with a reason (logged in the audit log and the booking's history). */
export async function changeTicketStatus(ticketDbId: unknown, status: unknown, reason: unknown): Promise<ActionResult> {
  if (!isId(ticketDbId)) return { ok: false, message: "That ticket couldn't be found." };
  const s = typeof status === "string" ? status : "";
  const why = typeof reason === "string" ? reason : "";
  const problem = first(validateTicketChange(s, why));
  if (problem) return { ok: false, message: problem };
  const supabase = await createClient();
  const { error } = await supabase.rpc("change_ticket_status", {
    p_ticket_id: ticketDbId,
    p_status: pick(s, TICKET_CHANGES, "Voided"),
    p_reason: why.trim(),
  });
  if (error) return { ok: false, message: friendly(error, "change this ticket") };
  refresh();
  return { ok: true };
}

/* ─────────────────────────── documents ─────────────────────────── */

/**
 * Records a file already uploaded from the browser to the private "ticket-documents" bucket
 * (the storage access rules decide who may upload). The path must be <organization>/<booking>/….
 */
export async function recordTicketDocument(bookingDbId: unknown, raw: unknown): Promise<ActionResult> {
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  const r = obj(raw);
  const path = str(r, "path");
  const fileName = str(r, "fileName").slice(0, 160);
  const mimeType = str(r, "mimeType");
  const size = typeof r.size === "number" ? r.size : 0;
  const kind = pick(r.kind, DOCUMENT_KINDS, "Other");
  const ticketId = r.ticketId ? str(r, "ticketId") : "";
  if (!path.startsWith(`${orgId}/${booking.id}/`)) return { ok: false, message: "The file wasn't uploaded to this booking's folder." };
  if (!fileName || !DOCUMENT_MIME_TYPES.includes(mimeType) || size < 1 || size > DOCUMENT_MAX_BYTES)
    return { ok: false, message: "Upload a PDF, PNG or JPEG of up to 20 MB." };
  if (ticketId && !isId(ticketId)) return { ok: false, message: "Choose the ticket again." };

  const { error } = await supabase.from("ticket_documents").insert({
    organization_id: orgId,
    booking_id: booking.id,
    ticket_id: ticketId || null,
    document_kind: kind,
    storage_path: path,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: size,
  });
  if (error) return { ok: false, message: friendly(error, "save this document") };
  await addEvent(supabase, orgId, booking.id, `${kind} uploaded: ${fileName}`);
  refresh();
  return { ok: true };
}

/** A short-lived (60 s) download link. The storage access rules decide who may read the file. */
export async function ticketDocumentUrl(documentDbId: unknown): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!isId(documentDbId)) return { ok: false, message: "That document couldn't be found." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("ticket_documents").select("storage_path, file_name").eq("id", documentDbId).maybeSingle();
  if (!doc) return { ok: false, message: "That document isn't available to you." };
  const { data, error } = await supabase.storage.from("ticket-documents").createSignedUrl(doc.storage_path as string, 60, { download: doc.file_name as string });
  if (error || !data) return { ok: false, message: "The file couldn't be opened. It may have been removed from storage." };
  return { ok: true, url: data.signedUrl };
}

export async function removeTicketDocument(bookingDbId: unknown, documentDbId: unknown): Promise<ActionResult> {
  if (!isId(documentDbId)) return { ok: false, message: "That document couldn't be found." };
  const ctx = await withBooking(bookingDbId);
  if ("message" in ctx) return { ok: false, message: ctx.message };
  const { supabase, orgId, booking } = ctx;
  const { data, error } = await supabase
    .from("ticket_documents")
    .delete()
    .eq("id", documentDbId)
    .eq("booking_id", booking.id)
    .select("storage_path, file_name, document_kind")
    .maybeSingle();
  if (error || !data) return { ok: false, message: friendly(error, "remove this document") };
  await supabase.storage.from("ticket-documents").remove([data.storage_path as string]);
  await addEvent(supabase, orgId, booking.id, `${data.document_kind} removed: ${data.file_name}`);
  refresh();
  return { ok: true };
}

/* ─────────────────────────── helpers ─────────────────────────── */

async function withBooking(bookingDbId: unknown): Promise<
  { supabase: SupabaseClient; orgId: string; booking: { id: string; created: string; status: string } } | { message: string }
> {
  if (!isId(bookingDbId)) return { message: "That booking couldn't be found." };
  const user = await getCurrentUser();
  if (!user.membership) return { message: "Your login isn't linked to an agency yet. Ask your admin." };
  const supabase = await createClient();
  const { data } = await supabase.from("bookings").select("id, created_at, status").eq("id", bookingDbId).maybeSingle();
  if (!data) return { message: "This booking no longer exists, or you can't see it." };
  return {
    supabase,
    orgId: user.membership.organizationId,
    booking: { id: data.id as string, created: (data.created_at as string).slice(0, 10), status: data.status as string },
  };
}

/** Timeline line (append-only). A failure here doesn't undo the change: the audit log has it too. */
async function addEvent(supabase: SupabaseClient, orgId: string, bookingId: string, text: string) {
  await supabase.from("booking_events").insert({ organization_id: orgId, booking_id: bookingId, body: text.slice(0, 300) });
}

/** Database errors as plain sentences. Messages raised by our own database functions are already written for people. */
function friendly(error: PostgrestError | null, action: string) {
  if (!error || error.code === "PGRST116" || /row-level security|permission denied/i.test(error.message)) {
    return `You don't have permission to ${action}.`;
  }
  if (["P0001", "P0002", "22023", "42501"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007" || error.code === "23502") {
    return "Some details weren't accepted. Check the formats (codes, dates, amounts) and try again.";
  }
  return `Couldn't ${action}. Try again in a moment.`;
}
