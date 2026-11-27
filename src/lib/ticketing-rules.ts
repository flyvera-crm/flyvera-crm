// Pure validation for ticketing forms (no React / browser APIs). The same rules run in the
// browser for instant feedback and in the Server Actions (src/lib/actions/ticketing.ts).
// The database enforces them again (formats, same-booking links, ticket rules in migration 16).
import type {
  CabinClass,
  PassengerType,
  PnrProvider,
  PnrStatus,
  PnrVerificationStatus,
  SegmentStatus,
  TicketDocumentKind,
  TicketStatus,
  TravelDocumentType,
} from "@/types/ticketing";

export const PASSENGER_TYPES: PassengerType[] = ["Adult", "Child", "Infant"];
export const PASSENGER_TITLES = ["Mr", "Mrs", "Ms", "Mx", "Dr", "Mstr", "Miss"];
export const DOCUMENT_TYPES: TravelDocumentType[] = ["Passport", "National ID", "Visa", "Residence permit"];
export const PNR_PROVIDERS: PnrProvider[] = ["Manual", "Amadeus", "Sabre", "Travelport", "NDC", "Airline direct"];
export const PNR_STATUSES: PnrStatus[] = ["Active", "Ticketed", "Cancelled", "Expired"];
export const PNR_VERIFICATION_STATUSES: PnrVerificationStatus[] = ["Pending", "Verified", "Not verified"];
export const CABIN_CLASSES: CabinClass[] = ["Economy", "Premium economy", "Business", "First"];
export const SEGMENT_STATUSES: SegmentStatus[] = ["Confirmed", "Waitlisted", "Cancelled", "Flown"];
export const TICKET_CHANGES: Exclude<TicketStatus, "Issued">[] = ["Voided", "Refunded", "Exchanged"];
export const DOCUMENT_KINDS: TicketDocumentKind[] = ["E-ticket", "Itinerary", "Voucher", "Invoice", "Other"];
export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024; // matches the storage bucket limit

const NAME_RE = /^\p{L}[\p{L}\p{M}' .-]*$/u;
const LOCATOR_RE = /^[A-Z0-9]{5,8}$/;
const CARRIER_RE = /^[A-Z0-9]{2}$/;
const AIRPORT_RE = /^[A-Z]{3}$/;
const FLIGHT_RE = /^[0-9]{1,4}[A-Z]?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

type Errors<K extends string> = Partial<Record<K, string>>;

/* ── Passengers ── */

export type PassengerFormValues = {
  type: PassengerType;
  title: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "" | "F" | "M" | "X";
  nationality: string;
  frequentFlyer: string;
  meal: string;
  assistance: string;
  isLead: boolean;
  customerCode: string; // "" = not a CRM customer
};

export const emptyPassenger: PassengerFormValues = {
  type: "Adult",
  title: "",
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  nationality: "",
  frequentFlyer: "",
  meal: "",
  assistance: "",
  isLead: false,
  customerCode: "",
};

export function validatePassenger(v: PassengerFormValues, today: string) {
  const e: Errors<keyof PassengerFormValues> = {};
  for (const key of ["firstName", "lastName"] as const) {
    const label = key === "firstName" ? "First name" : "Last name";
    const value = v[key].trim();
    if (!value) e[key] = `${label} is required — exactly as in the passport.`;
    else if (value.length > 50) e[key] = `${label} must be 50 characters or fewer.`;
    else if (!NAME_RE.test(value)) e[key] = `${label} can only contain letters, spaces, hyphens and apostrophes.`;
  }
  if (v.title && !PASSENGER_TITLES.includes(v.title)) e.title = "Choose a title from the list.";
  if (v.dateOfBirth) {
    if (!DATE_RE.test(v.dateOfBirth) || v.dateOfBirth <= "1900-01-01") e.dateOfBirth = "Check the date of birth.";
    else if (v.dateOfBirth > today) e.dateOfBirth = "Date of birth can't be in the future.";
  } else if (v.type !== "Adult") e.dateOfBirth = "Airlines need the date of birth for children and infants.";
  if (v.frequentFlyer.length > 30) e.frequentFlyer = "Keep it under 30 characters.";
  if (v.meal.length > 40) e.meal = "Keep it under 40 characters.";
  if (v.assistance.length > 200) e.assistance = "Keep it under 200 characters.";
  return e;
}

export type PassportFormValues = { documentType: TravelDocumentType; number: string; expiry: string; issuingCountry: string };

export function validatePassport(v: PassportFormValues, today: string) {
  const e: Errors<keyof PassportFormValues> = {};
  const n = v.number.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!n) e.number = "Enter the document number.";
  else if (!/^[A-Z0-9]{5,20}$/.test(n)) e.number = "Document numbers are 5–20 letters or digits.";
  if (!v.expiry) e.expiry = "Enter the expiry date.";
  else if (v.expiry <= today) e.expiry = "This document has expired.";
  if (!v.issuingCountry.trim()) e.issuingCountry = "Enter the issuing country.";
  return e;
}

/* ── Reservations (PNRs) ── */

export type PnrFormValues = {
  recordLocator: string;
  airlineLocator: string;
  /** Airline's 2-character code, e.g. "EK" (optional). */
  airline: string;
  provider: PnrProvider;
  status: PnrStatus;
  ticketingDeadline: string; // "YYYY-MM-DDTHH:mm" or ""
};

export const emptyPnr: PnrFormValues = { recordLocator: "", airlineLocator: "", airline: "", provider: "Manual", status: "Active", ticketingDeadline: "" };

export function validatePnr(v: PnrFormValues) {
  const e: Errors<keyof PnrFormValues> = {};
  const rec = v.recordLocator.trim().toUpperCase();
  if (!rec) e.recordLocator = "Enter the record locator (e.g. K7Q2MX).";
  else if (!LOCATOR_RE.test(rec)) e.recordLocator = "Record locators are 5–8 letters or digits.";
  const air = v.airlineLocator.trim().toUpperCase();
  if (air && !LOCATOR_RE.test(air)) e.airlineLocator = "Airline locators are 5–8 letters or digits.";
  const airline = v.airline.trim().toUpperCase();
  if (airline && !CARRIER_RE.test(airline)) e.airline = "Airline codes are 2 letters or digits (e.g. EK).";
  if (v.ticketingDeadline && !DATETIME_RE.test(v.ticketingDeadline)) e.ticketingDeadline = "Enter a date and time.";
  return e;
}

/* ── PNR verification (manual check with the airline / consolidator) ── */

export const VERIFY_NOTES_MAX = 500;

export type VerifyPnrValues = {
  /** The result of the check; "" until chosen. Pending can't be chosen: it means "not checked yet". */
  status: Exclude<PnrVerificationStatus, "Pending"> | "";
  notes: string;
};

export const emptyVerification: VerifyPnrValues = { status: "", notes: "" };

/** Same rules as the database function verify_pnr() (migration 23). */
export function validateVerification(v: VerifyPnrValues) {
  const e: Errors<keyof VerifyPnrValues> = {};
  if (v.status !== "Verified" && v.status !== "Not verified") e.status = "Choose Verified or Not verified.";
  const notes = v.notes.trim();
  if (v.status === "Not verified" && notes.length < 3) e.notes = "Say why the PNR could not be verified.";
  else if (notes.length > VERIFY_NOTES_MAX) e.notes = `Notes can be at most ${VERIFY_NOTES_MAX} characters.`;
  return e;
}

/**
 * Whether saving these PNR details sends its verification back to Pending: the database does this when
 * the record locator, airline locator, airline or provider changes (migration 23). Used to warn first.
 */
export function resetsVerification(
  before: { recordLocator: string; airlineLocator?: string; airline?: string; provider: PnrProvider; verification: { status: PnrVerificationStatus } },
  after: Pick<PnrFormValues, "recordLocator" | "airlineLocator" | "airline" | "provider">,
) {
  if (before.verification.status === "Pending") return false;
  const norm = (x: string | undefined) => (x ?? "").trim().toUpperCase();
  return (
    norm(before.recordLocator) !== norm(after.recordLocator) ||
    norm(before.airlineLocator) !== norm(after.airlineLocator) ||
    norm(before.airline) !== norm(after.airline) ||
    before.provider !== after.provider
  );
}

/* ── Flight legs ── */

export type SegmentFormValues = {
  pnrId: string;
  carrier: string;
  flightNumber: string;
  operatingCarrier: string;
  origin: string;
  destination: string;
  departsAt: string;
  arrivesAt: string;
  cabin: CabinClass;
  bookingClass: string;
  status: SegmentStatus;
};

export const emptySegment: SegmentFormValues = {
  pnrId: "",
  carrier: "",
  flightNumber: "",
  operatingCarrier: "",
  origin: "",
  destination: "",
  departsAt: "",
  arrivesAt: "",
  cabin: "Economy",
  bookingClass: "",
  status: "Confirmed",
};

export function validateSegment(v: SegmentFormValues) {
  const e: Errors<keyof SegmentFormValues> = {};
  const up = (s: string) => s.trim().toUpperCase();
  if (!CARRIER_RE.test(up(v.carrier))) e.carrier = "2-character airline code, e.g. EK.";
  if (!FLIGHT_RE.test(up(v.flightNumber))) e.flightNumber = "Flight number, e.g. 7 or 2401.";
  if (v.operatingCarrier.trim() && !CARRIER_RE.test(up(v.operatingCarrier))) e.operatingCarrier = "2-character airline code.";
  if (!AIRPORT_RE.test(up(v.origin))) e.origin = "3-letter airport code, e.g. DXB.";
  if (!AIRPORT_RE.test(up(v.destination))) e.destination = "3-letter airport code, e.g. LHR.";
  else if (up(v.origin) === up(v.destination)) e.destination = "Destination must differ from the origin.";
  if (!DATETIME_RE.test(v.departsAt)) e.departsAt = "Enter the departure date and time.";
  if (!DATETIME_RE.test(v.arrivesAt)) e.arrivesAt = "Enter the arrival date and time.";
  else if (DATETIME_RE.test(v.departsAt) && v.arrivesAt <= v.departsAt) e.arrivesAt = "Arrival must be after departure.";
  if (v.bookingClass.trim() && !/^[A-Z]$/.test(up(v.bookingClass))) e.bookingClass = "One letter, e.g. Y.";
  return e;
}

/* ── Tickets ── */

export type TicketFormValues = {
  passengerId: string;
  pnrId: string;
  ticketNumber: string;
  airline: string;
  baseFare: string;
  taxes: string;
  issuedOn: string;
  /** The agent confirms the number was issued by the airline / GDS (never assumed). */
  confirmed: boolean;
};

export const cleanTicketNumber = (s: string) => s.replace(/[\s-]/g, "");
const amount = (s: string) => Number(s.replace(/[,\s$]/g, ""));

export function validateTicket(v: TicketFormValues, today: string, bookingCreated: string) {
  const e: Errors<keyof TicketFormValues> = {};
  if (!v.passengerId) e.passengerId = "Choose the passenger.";
  if (!v.pnrId) e.pnrId = "Choose the reservation (PNR) it was issued on.";
  if (!/^[0-9]{13}$/.test(cleanTicketNumber(v.ticketNumber))) e.ticketNumber = "The 13-digit number from the airline, e.g. 176 2104810001.";
  if (!CARRIER_RE.test(v.airline.trim().toUpperCase())) e.airline = "2-character code of the issuing airline.";
  const fare = amount(v.baseFare);
  if (!v.baseFare.trim() || !Number.isFinite(fare) || fare < 0) e.baseFare = "Enter the fare shown on the ticket.";
  const tax = v.taxes.trim() ? amount(v.taxes) : 0;
  if (!Number.isFinite(tax) || tax < 0) e.taxes = "Enter the taxes shown on the ticket (or 0).";
  if (!DATE_RE.test(v.issuedOn)) e.issuedOn = "Enter the issue date.";
  else if (v.issuedOn > today) e.issuedOn = "The issue date can't be in the future.";
  else if (v.issuedOn < bookingCreated) e.issuedOn = "That's before the booking was created.";
  if (!v.confirmed) e.confirmed = "Confirm the ticket was issued by the airline or GDS.";
  return e;
}

export function validateTicketChange(status: string, reason: string) {
  const e: Errors<"status" | "reason"> = {};
  if (!TICKET_CHANGES.includes(status as (typeof TICKET_CHANGES)[number])) e.status = "Choose void, refund or exchange.";
  const r = reason.trim();
  if (r.length < 5) e.reason = "Explain why (at least 5 characters).";
  else if (r.length > 200) e.reason = "Keep the reason under 200 characters.";
  return e;
}

/** Shown on screen as entered (airport local time): "2026-12-01T09:30" → "1 Dec 2026, 09:30". */
export function formatLocalDateTime(value: string) {
  const [date, time] = value.split("T");
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return time ? `${day}, ${time.slice(0, 5)}` : day;
}
