// Ticketing records (passengers, PNRs, flight legs, tickets, documents) from Supabase.
// Server-side only, loaded by the booking page and the Tickets page (not by every page).
// Queries run as the signed-in user, so Row Level Security decides what each role sees.
//
// Times on flight legs and PNR deadlines are stored exactly as printed on the itinerary
// (airport / agency local time, saved with a +00:00 marker) and shown back unchanged.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BookingTicketing,
  CabinClass,
  Passenger,
  PassengerType,
  Pnr,
  PnrProvider,
  PnrStatus,
  Segment,
  SegmentStatus,
  Ticket,
  TicketDocument,
  TicketDocumentKind,
  TicketingAccess,
  TicketStatus,
  TravelDocumentType,
} from "@/types/ticketing";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";

const PASSENGER_ROLES: AppRole[] = ["admin", "ticketing_agent", "sales_manager", "sales_agent"];
const TICKET_ROLES: AppRole[] = ["admin", "ticketing_agent", "finance_manager", "sales_manager", "sales_agent"];
const MANAGE_ROLES: AppRole[] = ["admin", "ticketing_agent"];

export function ticketingAccess(role: AppRole | undefined): TicketingAccess {
  const has = (roles: AppRole[]) => Boolean(role && roles.includes(role));
  return {
    canSeePassengers: has(PASSENGER_ROLES),
    canEditPassengers: has(PASSENGER_ROLES),
    canRemovePassengers: has(MANAGE_ROLES),
    canSeeTravelRecords: Boolean(role),
    canSeeTickets: has(TICKET_ROLES),
    canManage: has(MANAGE_ROLES),
  };
}

/** "2026-12-01T09:30:00+00:00" → "2026-12-01T09:30" (shown as entered). */
export const localTime = (ts: string) => ts.slice(0, 16);
/** "2026-12-01T09:30" → stored with a +00:00 marker so it reads back unchanged. */
export const storeLocalTime = (value: string) => `${value}:00+00:00`;

const PASSENGER_COLUMNS =
  "id, passenger_type, title, first_name, last_name, date_of_birth, gender, nationality, document_type, document_last4, " +
  "document_issuing_country, document_expiry_on, frequent_flyer, meal_preference, special_assistance, is_lead_passenger, created_at, " +
  "customer:customers!passengers_customer_id_organization_id_fkey(code)";
const TICKET_COLUMNS =
  "id, booking_id, ticket_number, issuing_airline, status, base_fare, taxes, total, currency, issued_at, voided_at, passenger_id, pnr_id, " +
  "passenger:passengers!tickets_passenger_id_organization_id_fkey(first_name, last_name)";

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>) => (Array.isArray(v) ? (v[0] ?? null) : v);

type PassengerRow = {
  id: string;
  passenger_type: PassengerType;
  title: string | null;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: "F" | "M" | "X" | null;
  nationality: string | null;
  document_type: TravelDocumentType | null;
  document_last4: string | null;
  document_issuing_country: string | null;
  document_expiry_on: string | null;
  frequent_flyer: string | null;
  meal_preference: string | null;
  special_assistance: string | null;
  is_lead_passenger: boolean;
  created_at: string;
  customer: One<{ code: string }>;
};

export type TicketRow = {
  id: string;
  booking_id: string;
  ticket_number: string;
  issuing_airline: string;
  status: TicketStatus;
  base_fare: number | string;
  taxes: number | string;
  total: number | string;
  currency: string;
  issued_at: string;
  voided_at: string | null;
  passenger_id: string;
  pnr_id: string | null;
  passenger: One<{ first_name: string; last_name: string }>;
};

const mapPassenger = (p: PassengerRow): Passenger => ({
  id: p.id,
  type: p.passenger_type,
  title: p.title ?? undefined,
  firstName: p.first_name,
  lastName: p.last_name,
  dateOfBirth: p.date_of_birth ?? undefined,
  gender: p.gender ?? undefined,
  nationality: p.nationality ?? undefined,
  customerCode: one(p.customer)?.code,
  documentType: p.document_type ?? undefined,
  documentLast4: p.document_last4 ?? undefined,
  documentIssuingCountry: p.document_issuing_country ?? undefined,
  documentExpiry: p.document_expiry_on ?? undefined,
  frequentFlyer: p.frequent_flyer ?? undefined,
  meal: p.meal_preference ?? undefined,
  assistance: p.special_assistance ?? undefined,
  isLead: p.is_lead_passenger,
});

export const mapTicket = (t: TicketRow): Ticket => {
  const p = one(t.passenger);
  return {
    id: t.id,
    ticketNumber: t.ticket_number,
    airline: t.issuing_airline,
    status: t.status,
    baseFare: Number(t.base_fare),
    taxes: Number(t.taxes),
    total: Number(t.total),
    currency: t.currency,
    issuedAt: t.issued_at.slice(0, 10),
    voidedAt: t.voided_at?.slice(0, 10),
    passengerId: t.passenger_id,
    passengerName: p ? `${p.first_name} ${p.last_name}` : "Passenger",
    pnrId: t.pnr_id ?? undefined,
  };
};

/** Everything ticketing-related on one booking (by its code, e.g. FV-10001). Cached per request. */
export const getBookingTicketing = cache(async (bookingCode: string): Promise<BookingTicketing | null> => {
  const user = await getCurrentUser();
  const membership = user.membership;
  if (!membership) return null;
  const access = ticketingAccess(membership.role);
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id")
    .eq("organization_id", membership.organizationId)
    .eq("code", bookingCode)
    .maybeSingle();
  if (!booking) return null;
  return loadTicketing(supabase, booking.id as string, membership.organizationId, access);
});

export async function loadTicketing(
  supabase: SupabaseClient,
  bookingDbId: string,
  organizationId: string,
  access: TicketingAccess,
): Promise<BookingTicketing> {
  const none = Promise.resolve({ data: [] as never[] });
  const [passengers, pnrs, segments, tickets, documents] = await Promise.all([
    access.canSeePassengers
      ? supabase.from("passengers").select(PASSENGER_COLUMNS).eq("booking_id", bookingDbId).order("created_at").overrideTypes<PassengerRow[], { merge: false }>()
      : none,
    supabase
      .from("pnr_records")
      .select("id, record_locator, airline_locator, provider, status, ticketing_deadline, created_at")
      .eq("booking_id", bookingDbId)
      .order("created_at"),
    supabase
      .from("booking_segments")
      .select("id, segment_no, pnr_id, marketing_carrier, flight_number, operating_carrier, origin, destination, departs_at, arrives_at, cabin, booking_class, status")
      .eq("booking_id", bookingDbId)
      .order("segment_no"),
    access.canSeeTickets
      ? supabase.from("tickets").select(TICKET_COLUMNS).eq("booking_id", bookingDbId).order("issued_at").overrideTypes<TicketRow[], { merge: false }>()
      : none,
    access.canSeeTickets
      ? supabase
          .from("ticket_documents")
          .select("id, document_kind, file_name, mime_type, size_bytes, ticket_id, created_at")
          .eq("booking_id", bookingDbId)
          .order("created_at")
      : none,
  ]);

  return {
    bookingDbId,
    organizationId,
    access,
    passengers: ((passengers.data ?? []) as PassengerRow[]).map(mapPassenger),
    pnrs: ((pnrs.data ?? []) as {
      id: string;
      record_locator: string;
      airline_locator: string | null;
      provider: PnrProvider;
      status: PnrStatus;
      ticketing_deadline: string | null;
    }[]).map(
      (r): Pnr => ({
        id: r.id,
        recordLocator: r.record_locator,
        airlineLocator: r.airline_locator ?? undefined,
        provider: r.provider,
        status: r.status,
        ticketingDeadline: r.ticketing_deadline ? localTime(r.ticketing_deadline) : undefined,
      }),
    ),
    segments: ((segments.data ?? []) as {
      id: string;
      segment_no: number;
      pnr_id: string | null;
      marketing_carrier: string;
      flight_number: string;
      operating_carrier: string | null;
      origin: string;
      destination: string;
      departs_at: string;
      arrives_at: string;
      cabin: CabinClass;
      booking_class: string | null;
      status: SegmentStatus;
    }[]).map(
      (s): Segment => ({
        id: s.id,
        segmentNo: s.segment_no,
        pnrId: s.pnr_id ?? undefined,
        carrier: s.marketing_carrier,
        flightNumber: s.flight_number,
        operatingCarrier: s.operating_carrier ?? undefined,
        origin: s.origin,
        destination: s.destination,
        departsAt: localTime(s.departs_at),
        arrivesAt: localTime(s.arrives_at),
        cabin: s.cabin,
        bookingClass: s.booking_class ?? undefined,
        status: s.status,
      }),
    ),
    tickets: ((tickets.data ?? []) as TicketRow[]).map(mapTicket),
    documents: ((documents.data ?? []) as {
      id: string;
      document_kind: TicketDocumentKind;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      ticket_id: string | null;
      created_at: string;
    }[]).map(
      (d): TicketDocument => ({
        id: d.id,
        kind: d.document_kind,
        fileName: d.file_name,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes,
        ticketId: d.ticket_id ?? undefined,
        uploadedOn: d.created_at.slice(0, 10),
      }),
    ),
  };
}

export type TicketListItem = Ticket & { bookingCode: string; bookingTitle: string; recordLocator?: string };

/** Every ticket this user may see, newest first (Tickets page). */
export const getTicketList = cache(async (): Promise<{ tickets: TicketListItem[]; access: TicketingAccess }> => {
  const user = await getCurrentUser();
  const membership = user.membership;
  const access = ticketingAccess(membership?.role);
  if (!membership || !access.canSeeTickets) return { tickets: [], access };

  const supabase = await createClient();
  const [ticketsRes, bookingsRes, pnrsRes] = await Promise.all([
    supabase
      .from("tickets")
      .select(TICKET_COLUMNS)
      .eq("organization_id", membership.organizationId)
      .order("issued_at", { ascending: false })
      .limit(5000)
      .overrideTypes<TicketRow[], { merge: false }>(),
    supabase.from("bookings").select("id, code, title").eq("organization_id", membership.organizationId),
    supabase.from("pnr_records").select("id, record_locator").eq("organization_id", membership.organizationId),
  ]);
  if (ticketsRes.error) throw new Error(`Couldn't load tickets: ${ticketsRes.error.message}`);
  const bookings = new Map((bookingsRes.data ?? []).map((b) => [b.id as string, b as { code: string; title: string }]));
  const pnrs = new Map((pnrsRes.data ?? []).map((p) => [p.id as string, p.record_locator as string]));

  return {
    access,
    tickets: (ticketsRes.data ?? []).map((row) => ({
      ...mapTicket(row),
      bookingCode: bookings.get(row.booking_id)?.code ?? "",
      bookingTitle: bookings.get(row.booking_id)?.title ?? "",
      recordLocator: row.pnr_id ? pnrs.get(row.pnr_id) : undefined,
    })),
  };
});
