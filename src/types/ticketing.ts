// Ticketing records on a booking: passengers, airline reservations (PNRs), flight legs,
// tickets and their documents. Ids are database ids (uuids).

export type PassengerType = "Adult" | "Child" | "Infant";
export type TravelDocumentType = "Passport" | "National ID" | "Visa" | "Residence permit";
export type PnrProvider = "Amadeus" | "Sabre" | "Travelport" | "NDC" | "Airline direct" | "Manual";
export type PnrStatus = "Active" | "Ticketed" | "Cancelled" | "Expired";
export type CabinClass = "Economy" | "Premium economy" | "Business" | "First";
export type SegmentStatus = "Confirmed" | "Waitlisted" | "Cancelled" | "Flown";
export type TicketStatus = "Issued" | "Voided" | "Refunded" | "Exchanged";
export type TicketDocumentKind = "E-ticket" | "Itinerary" | "Voucher" | "Invoice" | "Other";

export type Passenger = {
  id: string;
  type: PassengerType;
  title?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: "F" | "M" | "X";
  nationality?: string;
  /** Code of the CRM customer this traveller is (CU-…), when linked. */
  customerCode?: string;
  /** Travel document snapshot. The number is encrypted: only its last 4 characters are loaded. */
  documentType?: TravelDocumentType;
  documentLast4?: string;
  documentIssuingCountry?: string;
  documentExpiry?: string;
  frequentFlyer?: string;
  meal?: string;
  assistance?: string;
  isLead: boolean;
};

export type Pnr = {
  id: string;
  recordLocator: string;
  airlineLocator?: string;
  provider: PnrProvider;
  status: PnrStatus;
  /** "YYYY-MM-DDTHH:mm" as entered (agency local time). */
  ticketingDeadline?: string;
};

export type Segment = {
  id: string;
  segmentNo: number;
  pnrId?: string;
  carrier: string;
  flightNumber: string;
  operatingCarrier?: string;
  origin: string;
  destination: string;
  /** Airport local times, "YYYY-MM-DDTHH:mm", exactly as printed on the itinerary. */
  departsAt: string;
  arrivesAt: string;
  cabin: CabinClass;
  bookingClass?: string;
  status: SegmentStatus;
};

export type Ticket = {
  id: string;
  ticketNumber: string;
  airline: string;
  status: TicketStatus;
  baseFare: number;
  taxes: number;
  total: number;
  currency: string;
  issuedAt: string; // ISO date
  voidedAt?: string;
  passengerId: string;
  passengerName: string;
  pnrId?: string;
};

export type TicketDocument = {
  id: string;
  kind: TicketDocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ticketId?: string;
  uploadedOn: string; // ISO date
};

/** What the signed-in user may do with ticketing records (mirrors the RLS rules in migrations 10 and 16). */
export type TicketingAccess = {
  /** Passengers (names, dates of birth, passport snapshot): admin, ticketing, sales in scope. */
  canSeePassengers: boolean;
  canEditPassengers: boolean;
  /** Remove a passenger (only one without tickets): admin, ticketing. */
  canRemovePassengers: boolean;
  /** PNRs and flight legs: every role (support reads them to answer flight questions). */
  canSeeTravelRecords: boolean;
  /** Tickets and documents (contain fares): admin, ticketing, finance, sales in scope. */
  canSeeTickets: boolean;
  /** Add PNRs and flights, record and change tickets, upload documents: admin, ticketing. */
  canManage: boolean;
};

export type BookingTicketing = {
  bookingDbId: string;
  organizationId: string;
  passengers: Passenger[];
  pnrs: Pnr[];
  segments: Segment[];
  tickets: Ticket[];
  documents: TicketDocument[];
  access: TicketingAccess;
};
