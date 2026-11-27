// Flight suppliers (GDS, NDC, consolidators). The CRM is supplier-neutral: each authorised connection
// implements FlightSupplier, and only offers returned by a connected supplier are ever shown or stored
// (the database refuses offers from app users and placeholder providers, migration 24).
//
// No supplier is connected yet, so the registry below is EMPTY on purpose. There is no demo or sample
// supplier: fares, availability and ticket numbers must never be invented. Pure, unit-tested.

export type CabinClass = "Economy" | "Premium economy" | "Business" | "First";

/** What an agent asks for (later filled in from a natural-language request, Phase 3). */
export type FlightSearchRequest = {
  origin: string; // IATA airport / city, e.g. "DXB"
  destination: string;
  departOn: string; // YYYY-MM-DD
  returnOn?: string;
  adults: number;
  children: number;
  infants: number;
  cabin: CabinClass;
  preferredAirlines?: string[]; // 2-character codes
  maxBudget?: { amount: number; currency: string };
};

export type OfferSegment = {
  carrier: string; // marketing carrier, 2 characters
  flightNumber: string;
  origin: string;
  destination: string;
  departsAt: string; // ISO, as returned by the supplier
  arrivesAt: string;
  operatingCarrier?: string;
};

/** An offer exactly as a supplier returned it, in one common shape. */
export type SupplierOffer = {
  supplier: string; // the connected supplier's name, e.g. "Amadeus"
  supplierOfferId: string; // the supplier's own ID for this offer
  fetchedAt: string; // ISO: when the supplier returned it
  expiresAt?: string;
  validatingCarrier?: string;
  baseAmount: number;
  taxAmount: number;
  currency: string;
  segments: OfferSegment[];
  fareBrand?: string;
  refundable?: boolean;
  changeable?: boolean;
  seatsAvailable?: number;
  baggage?: unknown; // as returned by the supplier
  fareRules?: unknown; // as returned by the supplier
  raw?: unknown; // the supplier's own response, kept for audit
};

/** One authorised connection. Booking and ticketing always need a person's approval first (Phase 4). */
export interface FlightSupplier {
  /** Name shown to staff and stored with each offer, e.g. "Amadeus". */
  readonly name: string;
  readonly kind: "GDS" | "NDC" | "Consolidator";
  search(request: FlightSearchRequest): Promise<SupplierOffer[]>;
  price(offerId: string): Promise<SupplierOffer>;
  fareRules(offerId: string): Promise<unknown>;
}

/** Placeholder names the database also refuses (migration 24): offers never come from these. */
export const PLACEHOLDER_SUPPLIER_NAMES = ["manual", "demo", "sample", "test", "mock", "fake"];

/**
 * Connected suppliers. Empty until an authorised GDS / NDC / consolidator account is configured.
 * Do not add demo, sample or mock suppliers here.
 */
const CONNECTED_SUPPLIERS: readonly FlightSupplier[] = [];

export function connectedSuppliers(): readonly FlightSupplier[] {
  return CONNECTED_SUPPLIERS;
}

export const liveSearchAvailable = () => connectedSuppliers().length > 0;

const IATA_RE = /^[A-Z]{3}$/;
const CARRIER_RE = /^[A-Z0-9]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const isIso = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s));
const money = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * Checks an offer before it may be stored or shown: it must name a real connected supplier and carry
 * the supplier's own offer ID, fetch time, fares, currency and at least one valid flight. Returns the
 * problems found (empty = acceptable).
 */
export function supplierOfferProblems(offer: SupplierOffer, connected: readonly { name: string }[] = connectedSuppliers()): string[] {
  const p: string[] = [];
  const name = typeof offer?.supplier === "string" ? offer.supplier.trim() : "";
  if (!name || PLACEHOLDER_SUPPLIER_NAMES.includes(name.toLowerCase())) p.push("Offer has no real supplier.");
  else if (!connected.some((s) => s.name === name)) p.push(`Supplier ${name} isn't connected.`);
  if (typeof offer?.supplierOfferId !== "string" || !offer.supplierOfferId.trim()) p.push("Offer has no supplier offer ID.");
  if (!isIso(offer?.fetchedAt)) p.push("Offer has no fetch time.");
  if (!money(offer?.baseAmount) || !money(offer?.taxAmount)) p.push("Offer has no valid fare.");
  if (typeof offer?.currency !== "string" || !CURRENCY_RE.test(offer.currency)) p.push("Offer has no valid currency.");
  if (offer?.validatingCarrier !== undefined && !CARRIER_RE.test(offer.validatingCarrier)) p.push("Offer has an invalid validating carrier.");
  const segs = Array.isArray(offer?.segments) ? offer.segments : [];
  if (segs.length === 0) p.push("Offer has no flights.");
  for (const s of segs) {
    if (!CARRIER_RE.test(s?.carrier ?? "") || !IATA_RE.test(s?.origin ?? "") || !IATA_RE.test(s?.destination ?? "") || !isIso(s?.departsAt) || !isIso(s?.arrivesAt)) {
      p.push("Offer has an incomplete flight.");
      break;
    }
  }
  return p;
}
