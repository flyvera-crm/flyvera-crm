// ⚠️ DEMO DATA: builds a believable trip history for a customer.
// It's "seeded" by the customer ID, so the same customer always gets the same trips.
// Later, replace getCustomerTrips() with a query to the Bookings module / API.
import type { Customer } from "@/types/crm";

export type TripStatus = "In progress" | "Completed" | "Cancelled";

export type Trip = {
  bookingId: string;
  destination: string;
  kind: string;
  departDate: string; // ISO
  returnDate: string; // ISO
  nights: number;
  travellers: number;
  amount: number;
  status: TripStatus;
};

const DESTINATIONS = [
  "Dubai", "London", "Paris", "Maldives", "Bangkok", "New York", "Istanbul", "Bali",
  "Rome", "Tokyo", "Santorini", "Zurich", "Singapore", "Marrakech", "Cape Town", "Lisbon",
];
const KINDS = ["Flights + hotel", "Flights only", "Holiday package", "Flights + hotel"];
export const MAX_TRIPS_SHOWN = 8;

/** Small deterministic random-number generator (mulberry32) seeded from a string. */
function seeded(seed: string) {
  let h = 1779033703;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Most recent trips first (at most MAX_TRIPS_SHOWN). */
export function getCustomerTrips(c: Customer): Trip[] {
  if (c.trips === 0 || !c.lastTrip) return [];
  const rand = seeded(c.id);
  const avg = c.lifetimeValue / c.trips;
  const trips: Trip[] = [];
  let depart = c.lastTrip;

  for (let i = 0; i < Math.min(c.trips, MAX_TRIPS_SHOWN); i++) {
    const useFavourite = c.favouriteDestination && (i === 0 || rand() < 0.35);
    const destination = useFavourite ? c.favouriteDestination : DESTINATIONS[Math.floor(rand() * DESTINATIONS.length)];
    const nights = 3 + Math.floor(rand() * 10);
    const travelling = i === 0 && c.status === "Travelling";
    trips.push({
      bookingId: `FV-${10000 + Math.floor(rand() * 480) + (MAX_TRIPS_SHOWN - i) * 60}`,
      destination,
      kind: KINDS[Math.floor(rand() * KINDS.length)],
      departDate: depart,
      returnDate: addDays(depart, nights),
      nights,
      travellers: 1 + Math.floor(rand() * 3),
      amount: Math.round((avg * (0.6 + rand() * 0.8)) / 10) * 10,
      status: travelling ? "In progress" : rand() < 0.08 ? "Cancelled" : "Completed",
    });
    depart = addDays(depart, -(35 + Math.floor(rand() * 150)));
    if (depart < c.joined) break;
  }
  return trips;
}
