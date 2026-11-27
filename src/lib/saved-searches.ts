// Saved flight searches, as shown on the Flights page. Pure and unit-tested: turns a flight_searches row
// (plus its reading and link) into what the list shows. Every value from the row's `request` JSON is
// re-checked, because rows saved by earlier versions (or edited by hand) may lack fields or hold anything.
// Nothing here is a fare, availability, allowance, PNR or ticket: the searches were never sent to a supplier.

export type SavedFlight = { origin: string; destination: string; departOn: string };

export type SavedSearch = {
  id: string;
  savedAt: string;
  savedBy: string;
  tripType: "One-way" | "Return" | "Multi-city";
  flights: SavedFlight[]; // in order; the first is the table's own columns
  returnOn: string | null;
  flexibleDays: number | null;
  passengers: string; // "2 adults, 1 child"
  cabin: string;
  details: { label: string; value: string }[]; // the customer's other requests, in display order
  notes: string[];
  openQuestions: string[];
  typedRequest: string | null; // what the agent typed, from the reading log (if visible to this person)
  link: { kind: "lead" | "customer"; code: string; name: string } | { kind: "hidden" } | null;
  searched: boolean;
};

export type SearchRow = {
  id: string;
  origin: string;
  destination: string;
  depart_on: string;
  return_on: string | null;
  adults: number;
  children: number;
  infants: number;
  cabin: string;
  request: unknown;
  searched_at: string;
  created_by: string | null;
  lead_id: string | null;
  customer_id: string | null;
};

const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const strList = (v: unknown, max = 100, count = 12) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, count) : []);
const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function passengersText(adults: number, children: number, infants: number) {
  return [plural(adults, "adult", "adults"), children ? plural(children, "child", "children") : "", infants ? plural(infants, "infant", "infants") : ""]
    .filter(Boolean)
    .join(", ");
}

/** One row of the list. `names` maps user ids to display names; `typed` maps reading ids to the typed text. */
export function savedSearchFromRow(
  row: SearchRow,
  opts: { names?: Map<string, string>; typed?: Map<string, string>; lead?: { code: string; name: string } | null; customer?: { code: string; name: string } | null } = {},
): SavedSearch {
  const r = (row.request && typeof row.request === "object" && !Array.isArray(row.request) ? row.request : {}) as Record<string, unknown>;

  const further = (Array.isArray(r.further_legs) ? r.further_legs : [])
    .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
    .map((l) => ({ origin: str(l.origin, 3), destination: str(l.destination, 3), departOn: str(l.depart_on, 10) }))
    .filter((l) => IATA_RE.test(l.origin) && IATA_RE.test(l.destination) && DATE_RE.test(l.departOn))
    .slice(0, 5);
  const flights = [{ origin: row.origin, destination: row.destination, departOn: row.depart_on }, ...further];
  const tripType = further.length ? "Multi-city" : row.return_on ? "Return" : r.trip_type === "Multi-city" ? "Multi-city" : "One-way";

  const details: { label: string; value: string }[] = [];
  const add = (label: string, value: string) => value && details.push({ label, value });
  const stops = str(r.stops, 20);
  add("Stops", ["Direct only", "Up to 1 stop", "Up to 2 stops", "Any"].includes(stops) ? stops : "");
  add("Connect via", strList(r.via, 3, 3).filter((c) => IATA_RE.test(c)).join(", "));
  const hours = int(r.max_connection_hours, 1, 24);
  add("Max connection", hours ? `${hours} h` : "");
  const times = (r.time_preferences && typeof r.time_preferences === "object" ? r.time_preferences : {}) as Record<string, unknown>;
  add("Departure time", str(times.outbound, 20));
  add("Return time", str(times.return, 20));
  add("Preferred airlines", strList(r.preferred_airlines, 2, 6).join(", "));
  const bag = (r.baggage_requested && typeof r.baggage_requested === "object" ? r.baggage_requested : null) as Record<string, unknown> | null;
  if (bag) {
    const need = str(bag.need, 20);
    const count = int(bag.checked_bags, 1, 9);
    const note = str(bag.note, 60);
    add("Baggage requested", [need === "Checked bags" && count ? plural(count, "checked bag", "checked bags") : need, note].filter(Boolean).join(", "));
  }
  add("Fare conditions requested", strList(r.fare_conditions_requested, 20, 4).join(", "));
  const budget = (r.budget && typeof r.budget === "object" ? r.budget : null) as Record<string, unknown> | null;
  if (budget && typeof budget.amount === "number" && Number.isFinite(budget.amount) && budget.amount > 0) {
    add("Budget (agent's figure)", `${str(budget.currency, 3)} ${budget.amount.toLocaleString("en-US")}`.trim());
  }

  const lead = opts.lead ?? null;
  const customer = opts.customer ?? null;
  const link: SavedSearch["link"] = lead
    ? { kind: "lead", ...lead }
    : customer
      ? { kind: "customer", ...customer }
      : row.lead_id || row.customer_id
        ? { kind: "hidden" }
        : null;
  const readingId = str(r.ai_action_id, 40);

  return {
    id: row.id,
    savedAt: row.searched_at,
    savedBy: (row.created_by && opts.names?.get(row.created_by)) || "Unknown",
    tripType,
    flights,
    returnOn: tripType === "Return" ? row.return_on : null,
    flexibleDays: int(r.flexible_days, 0, 7),
    passengers: passengersText(row.adults, row.children, row.infants),
    cabin: row.cabin,
    details,
    notes: strList(r.notes, 100, 8),
    openQuestions: strList(r.open_questions, 200, 12),
    typedRequest: (readingId && opts.typed?.get(readingId)) || null,
    link,
    searched: r.searched === true,
  };
}
