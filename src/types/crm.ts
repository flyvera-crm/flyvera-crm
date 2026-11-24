// Shared domain types. When real APIs are added later, API responses
// should be mapped into these shapes so the UI doesn't need to change.

// Booking lifecycle: Pending (awaiting deposit) → Confirmed → Ticketed (documents issued) → Completed (travelled)
export type BookingStatus = "Pending" | "Confirmed" | "Ticketed" | "Completed" | "Cancelled";
export type LeadStage = "New" | "Contacted" | "Quoted" | "Negotiation" | "Won" | "Lost";
export type LeadSource = "WhatsApp" | "Website" | "Referral" | "Instagram" | "Phone" | "Walk-in";
export type LeadPriority = "Hot" | "Warm" | "Cold";
export type TripType = "Holiday" | "Honeymoon" | "Family" | "Business" | "Umrah" | "Group";

export type Lead = {
  id: string; // e.g. "LD-2041"
  name: string;
  phone: string;
  email?: string;
  source: LeadSource;
  stage: LeadStage;
  priority: LeadPriority;
  destination: string;
  tripType: TripType;
  departDate?: string; // ISO
  returnDate?: string; // ISO
  travellers: number;
  budget: number; // estimated trip value
  agent: string;
  created: string; // ISO
  lastContact: string; // ISO
  nextFollowUp?: string; // ISO
  notes?: string;
  lostReason?: string;
  customerId?: string; // customer code (CU-…), set once converted to a customer
  // Set for leads loaded from the database:
  /** Database row id. The readable code (LD-2001) is `id`. */
  dbId?: string;
  /** User id of the assigned agent; `agent` holds their display name. */
  agentId?: string;
};
export type FlightStatus = "On time" | "Delayed" | "Boarding" | "Scheduled";

export type Kpi = {
  label: string;
  value: number;
  format: "currency" | "number" | "percent";
  delta: number; // % change vs previous period
  period: string;
  icon: "wallet" | "calendar" | "target" | "users";
  trend: number[];
};

export type PaymentMethod = "Card" | "Bank transfer" | "Cash" | "Other";

export type BookingPayment = {
  id: string; // "p1", "p2"… for payments, "r1", "r2"… for refunds (the database's sequence numbers)
  date: string; // ISO
  amount: number; // always positive; refunds are marked with kind
  method: PaymentMethod;
  note?: string;
  kind?: "payment" | "refund"; // default "payment"
  // Set for payments loaded from the database:
  dbId?: string;
  reference?: string;
  /** true when Finance has corrected this payment since it was recorded (see the booking's history). */
  corrected?: boolean;
};

/** A booked service = a quotation line + the supplier's reference once confirmed. */
export type BookingService = QuoteItem & {
  ref?: string; // airline PNR, hotel confirmation number, etc.
  supplierPaidOn?: string; // ISO date the agency paid the supplier for this service
};

export type BookingEvent = { date: string; text: string };

export type Booking = {
  id: string; // e.g. "FV-10481"
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  quoteId?: string; // the accepted quotation it came from
  title: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  adults: number;
  children: number;
  services: BookingService[];
  discount: number;
  taxRate: number;
  status: BookingStatus;
  payments: BookingPayment[];
  depositDue: string; // ISO
  balanceDue: string; // ISO — full payment needed by this date
  agent: string;
  created: string;
  updated: string;
  cancelReason?: string;
  refundSettled?: boolean; // cancelled: money kept as a fee (no further refund due)
  history: BookingEvent[]; // newest last
  // Set for bookings loaded from the database:
  /** Database row id. The readable code (FV-10001) is `id`. */
  dbId?: string;
  /** User id of the booking's agent; `agent` holds their display name. */
  agentId?: string;
  /** true for roles that may not see prices or payments (support): money figures are blank, not zero. */
  moneyHidden?: boolean;
  /**
   * Passengers and how many hold an issued ticket (database bookings). `visible` is false for
   * roles that can't see passengers or tickets — they can't complete the ticketing step.
   */
  ticketing?: { visible: boolean; passengers: number; ticketedPassengers: number };
  /** Refund requests on this booking, newest last (migration 18). */
  refundRequests?: RefundRequest[];
};

export type RefundRequestStatus = "Requested" | "Approved" | "Paid" | "Rejected" | "Withdrawn";
export type RefundCategory = "Cancellation" | "Airline refund" | "Schedule change" | "Duplicate payment" | "Other";

export type RefundRequest = {
  dbId: string;
  reference: string; // RF-10477-1
  status: RefundRequestStatus;
  amount: number; // approved / paid amount (may be less than requested)
  requestedAmount: number;
  method: PaymentMethod;
  category?: RefundCategory;
  details?: string;
  requestedById?: string;
  requestedByName: string;
  requestedOn: string; // ISO date
  decisionNote?: string;
  decidedByName?: string;
  paidOn?: string;
  paymentReference?: string;
  /** Recorded by Finance in one step (money already sent) — no separate approval. */
  recordedDirectly: boolean;
};

export type Flight = {
  id: string;
  flightNo: string;
  airline: string;
  from: string;
  to: string;
  departure: string;
  passenger: string;
  pax: number;
  status: FlightStatus;
};

export type Activity = {
  id: string;
  who: string;
  action: string;
  target: string;
  time: string;
  kind: "lead" | "payment" | "booking" | "whatsapp" | "ticket";
};

export type CustomerTier = "Platinum" | "Gold" | "Silver" | "Standard";
export type CustomerStatus = "Active" | "Travelling" | "Inactive";
export type ContactMethod = "WhatsApp" | "Email" | "Phone";
export type SeatPreference = "No preference" | "Window" | "Aisle" | "Extra legroom";

export type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  tier: CustomerTier;
  status: CustomerStatus;
  trips: number;
  lifetimeValue: number;
  lastTrip: string | null; // ISO date (YYYY-MM-DD)
  favouriteDestination: string;
  agent: string;
  joined: string; // ISO date
  // Optional profile details (captured by the Add customer form)
  dateOfBirth?: string; // ISO date
  nationality?: string;
  passportNumber?: string;
  passportExpiry?: string; // ISO date
  preferredContact?: ContactMethod;
  seatPreference?: SeatPreference;
  whatsappOptIn?: boolean;
  notes?: string;
  // Set for customers loaded from the database (not for demo data):
  /** Database row id. The readable code (CU-1001) is `id`. */
  dbId?: string;
  /** User id of the assigned agent; `agent` holds their display name. */
  agentId?: string;
  /** Stored passport. The number is encrypted: only its last 4 characters are loaded. */
  passport?: StoredPassport;
  /** true when this user's role may not see trip and money figures. */
  statsHidden?: boolean;
};

export type StoredPassport = {
  documentId: string;
  last4: string;
  expiry: string; // ISO date
  issuingCountry: string;
};

export type QuoteStatus = "Draft" | "Sent" | "Accepted" | "Declined";
/** What the UI shows: a Sent quote past its validity date is displayed as "Expired". */
export type QuoteDisplayStatus = QuoteStatus | "Expired";
export type QuoteItemType = "Flight" | "Hotel" | "Transfer" | "Activity" | "Insurance" | "Visa" | "Other";

export type QuoteItem = {
  id: string;
  type: QuoteItemType;
  description: string;
  quantity: number;
  unitPrice: number; // selling price per unit (what the customer pays)
  cost: number; // total supplier cost for this line (internal only)
  /** Database row id (quotation lines loaded from the database). `id` is a short local key like "i1". */
  dbId?: string;
};

export type QuoteRecipient = {
  kind: "customer" | "lead";
  id: string; // CU-… or LD-…
  name: string;
  email?: string;
  phone: string;
};

export type Quotation = {
  id: string; // e.g. "QT-3002"
  recipient: QuoteRecipient; // snapshot at the time of quoting
  title: string;
  destination: string;
  departDate?: string;
  returnDate?: string;
  adults: number;
  children: number;
  items: QuoteItem[];
  discount: number; // amount off the subtotal
  taxRate: number; // percent
  validUntil: string;
  status: QuoteStatus;
  notes?: string; // shown on the quotation
  agent: string;
  created: string;
  updated: string;
  sentAt?: string;
  respondedAt?: string;
  // Set for quotations loaded from the database:
  /** Database row id. The readable code (QT-3001) is `id`. */
  dbId?: string;
  /** User id of the agent who prepared it; `agent` holds their display name. */
  agentId?: string;
};

export type MonthlyRevenue = { month: string; revenue: number };
export type LabeledValue = { label: string; value: number };
