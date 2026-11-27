// Reading a flight request: the agent types a trip request in plain words, the local reader
// (src/lib/flight-request-parser.ts, no AI service) turns it into search details, and the AGENT reviews
// and approves them before anything is saved. Pure, unit-tested.
//
// Rules this module enforces (the database repeats the important ones, migration 25):
//  • The reading has NO fields for fares, flights, schedules, availability, baggage allowances, PNRs or
//    ticket numbers, so none can be invented. Baggage and fare rules are the CUSTOMER'S REQUIREMENTS, never
//    a confirmed allowance or condition. Nothing here shows a price except the budget the agent typed.
//  • No personal identification details in the request text (it is kept in the log): e-mail addresses,
//    phone / ID numbers, passport-style numbers and the linked customer's / lead's name are refused.
//  • Every value read is re-checked here; anything invalid becomes a question for the agent.

export const DAILY_LIMIT = 50; // readings per person per day (UTC); also enforced by the database
export const MAX_REQUEST_CHARS = 1000;
export const CABINS = ["Economy", "Premium economy", "Business", "First"] as const;
export type Cabin = (typeof CABINS)[number];
export const TRIP_TYPES = ["One-way", "Return", "Multi-city"] as const;
export type TripType = (typeof TRIP_TYPES)[number];
export const STOPS = ["", "Direct only", "Up to 1 stop", "Up to 2 stops", "Any"] as const;
export type Stops = (typeof STOPS)[number];
export const TIME_SLOTS = ["", "Morning", "Afternoon", "Evening", "Night"] as const;
export const BAGGAGE = ["", "Cabin bag only", "Checked bags"] as const;
export type Baggage = (typeof BAGGAGE)[number];
export const FARE_RULES = ["Refundable", "Changeable", "Lowest fare", "Restrictions OK"] as const;
export const FLEX_DAYS = ["", "0", "1", "2", "3", "7"] as const;
export const MAX_EXTRA_LEGS = 5; // a multi-city trip has at most 6 legs

/** One more flight of a multi-city trip (the first flight is origin → destination on departOn). */
export type Leg = { origin: string; destination: string; departOn: string };

/** The search details the agent reviews (strings, as in a form). */
export type FlightRequestDraft = {
  tripType: TripType;
  origin: string; // IATA airport or city code
  destination: string;
  departOn: string; // YYYY-MM-DD or ""
  returnOn: string; // YYYY-MM-DD, or "" unless tripType is Return
  legs: Leg[]; // further flights of a multi-city trip
  flexibleDays: string; // "" (not stated), "0" (exact) … "7": ± days
  adults: string;
  children: string;
  infants: string;
  cabin: Cabin;
  stops: Stops;
  via: string; // connection airports the customer asked for, comma-separated
  maxConnectionHours: string;
  departTime: string; // "", Morning…Night, "After HH:MM" or "Before HH:MM"
  returnTime: string;
  preferredAirlines: string; // 2-character codes, comma-separated
  baggage: Baggage; // what the customer needs, never a confirmed allowance
  checkedBags: string;
  baggageNote: string;
  fareRules: string; // requested conditions from FARE_RULES, comma-separated (never a confirmed rule)
  budgetAmount: string; // the agent's own budget, never a fare
  budgetCurrency: string;
  notes: string; // other requests, one per line
};

export const emptyDraft: FlightRequestDraft = {
  tripType: "One-way",
  origin: "",
  destination: "",
  departOn: "",
  returnOn: "",
  legs: [],
  flexibleDays: "",
  adults: "1",
  children: "0",
  infants: "0",
  cabin: "Economy",
  stops: "",
  via: "",
  maxConnectionHours: "",
  departTime: "",
  returnTime: "",
  preferredAirlines: "",
  baggage: "",
  checkedBags: "",
  baggageNote: "",
  fareRules: "",
  budgetAmount: "",
  budgetCurrency: "USD",
  notes: "",
};

/* ── No personal data in the request ──────────────────────────────────────── */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const DATE_LIKE_RE = /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g;
const NUMBER_RUN_RE = /\+?\d[\d\s().-]{5,}\d/g;
const PASSPORT_LIKE_RE = /\b[A-Za-z]{1,2}\d{6,9}\b/;

/**
 * Why a request can't be read as written, or null. The text is kept in the reading log, so only trip
 * details belong in it. Mirrors the database check (migration 25).
 */
export function personalDataProblem(text: string, linkedNames: string[] = []): string | null {
  if (EMAIL_RE.test(text)) return "Remove the e-mail address: only trip details belong in the request.";
  const withoutDates = text.replace(DATE_LIKE_RE, " ");
  for (const run of withoutDates.match(NUMBER_RUN_RE) ?? []) {
    if (run.replace(/\D/g, "").length >= 7) return "Remove phone numbers and ID numbers: only trip details belong in the request.";
  }
  if (PASSPORT_LIKE_RE.test(text)) return "Remove passport or other document numbers: only trip details belong in the request.";
  const words = new Set(text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z']+/).filter(Boolean));
  for (const full of linkedNames) {
    for (const part of full.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z']+/)) {
      if (part.length >= 3 && words.has(part)) return "Remove the customer's name: link the lead or customer below instead.";
    }
  }
  return null;
}

/** Checks the request text before it is read or logged. */
export function requestTextProblem(text: unknown, linkedNames: string[] = []): string | null {
  if (typeof text !== "string" || !text.trim()) return "Describe the trip first.";
  if (text.length > MAX_REQUEST_CHARS) return `Keep the request under ${MAX_REQUEST_CHARS} characters.`;
  return personalDataProblem(text, linkedNames);
}

/* ── Shared checks ────────────────────────────────────────────────────────── */

const IATA_RE = /^[A-Z]{3}$/;
const AIRLINE_RE = /^[A-Z0-9]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:Morning|Afternoon|Evening|Night|(?:After|Before) (?:[01]\d|2[0-3]):[0-5]\d)$/;
const isRealDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const intOr = (v: unknown, fallback: number | null) => (typeof v === "number" && Number.isInteger(v) ? v : fallback);
const list = (s: string) => s.split(",").map((a) => a.trim().toUpperCase()).filter(Boolean);
/** Free text the agent can edit: one line, no control characters, limited length. */
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/* ── Checking the reading ─────────────────────────────────────────────────── */

/**
 * Turns the reader's raw answer into a draft for the agent, keeping only valid values. Anything invalid or
 * missing is left blank (or at a safe default) with a question for the agent. Never throws.
 */
export function draftFromReading(raw: unknown, today: string): { draft: FlightRequestDraft; questions: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const questions: string[] = [];
  const ask = (q: string) => questions.includes(q) || questions.push(q);
  const draft: FlightRequestDraft = { ...emptyDraft, legs: [] };

  const code = (v: unknown) => {
    const s = typeof v === "string" ? v.trim().toUpperCase() : "";
    return IATA_RE.test(s) ? s : "";
  };
  draft.origin = code(r.origin);
  if (!draft.origin) ask("Which departure airport or city?");
  draft.destination = code(r.destination);
  if (!draft.destination) ask("Which arrival airport or city?");
  if (draft.origin && draft.origin === draft.destination) {
    draft.destination = "";
    ask("Which arrival airport or city?");
  }

  const date = (v: unknown, notBefore: string) => (typeof v === "string" && isRealDate(v) && v >= notBefore ? v : "");
  draft.departOn = date(r.depart_on, today);
  if (!draft.departOn) ask("What is the departure date?");
  draft.returnOn = date(r.return_on, today);
  if (draft.returnOn && draft.departOn && draft.returnOn < draft.departOn) {
    draft.returnOn = "";
    ask("What is the return date?");
  }

  // Further legs of a multi-city trip, each checked like the first.
  const legs = Array.isArray(r.legs) ? r.legs.slice(0, MAX_EXTRA_LEGS) : [];
  let previous = draft.departOn || today;
  legs.forEach((raw, i) => {
    const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const leg = { origin: code(l.origin), destination: code(l.destination), departOn: date(l.depart_on, previous) };
    if (!leg.origin || !leg.destination || leg.origin === leg.destination) ask(`Flight ${i + 2}: which airports?`);
    if (!leg.departOn) ask(`Flight ${i + 2}: what is the date?`);
    if (leg.departOn) previous = leg.departOn;
    draft.legs.push(leg);
  });
  const type = typeof r.trip_type === "string" && (TRIP_TYPES as readonly string[]).includes(r.trip_type) ? (r.trip_type as TripType) : null;
  draft.tripType = draft.legs.length ? "Multi-city" : type === "Return" || draft.returnOn ? "Return" : type === "Multi-city" ? "Multi-city" : "One-way";
  if (draft.tripType === "Multi-city") {
    draft.returnOn = "";
    if (!draft.legs.length) ask("List each flight of the multi-city trip (from, to, date).");
  }
  if (draft.tripType === "Return" && !draft.returnOn) ask("What is the return date?");

  const flex = intOr(r.flexible_days, null);
  if (flex !== null && flex >= 0 && flex <= 7) draft.flexibleDays = String([0, 1, 2, 3, 7].find((d) => d >= flex) ?? 7);

  const adults = intOr(r.adults, null);
  if (adults !== null && adults >= 1 && adults <= 9) draft.adults = String(adults);
  else ask("How many adults are travelling?");
  const children = intOr(r.children, 0);
  draft.children = children !== null && children >= 0 && children <= 9 ? String(children) : "0";
  const infants = intOr(r.infants, 0);
  if (infants !== null && infants >= 0 && infants <= Number(draft.adults)) draft.infants = String(infants);
  else ask("How many infants (each infant needs an adult)?");

  if (typeof r.cabin === "string" && (CABINS as readonly string[]).includes(r.cabin)) draft.cabin = r.cabin as Cabin;
  else ask("Which cabin class?");

  if (typeof r.stops === "string" && (STOPS as readonly string[]).includes(r.stops)) draft.stops = r.stops as Stops;
  const via = (Array.isArray(r.via) ? r.via : []).map(code).filter((c) => c && c !== draft.origin && c !== draft.destination);
  draft.via = [...new Set(via)].slice(0, 3).join(", ");
  if (draft.stops === "Direct only" && draft.via) ask(`A direct flight can't connect in ${draft.via}: which is it?`);
  const hours = intOr(r.max_connection_hours, null);
  if (hours !== null && hours >= 1 && hours <= 24) draft.maxConnectionHours = String(hours);
  for (const k of ["depart_time", "return_time"] as const) {
    const t = typeof r[k] === "string" ? (r[k] as string) : "";
    if (TIME_RE.test(t)) draft[k === "depart_time" ? "departTime" : "returnTime"] = t;
  }

  const airlines = Array.isArray(r.preferred_airlines)
    ? r.preferred_airlines.map((a) => (typeof a === "string" ? a.trim().toUpperCase() : "")).filter((a) => AIRLINE_RE.test(a))
    : [];
  draft.preferredAirlines = [...new Set(airlines)].slice(0, 6).join(", ");

  if (typeof r.baggage === "string" && (BAGGAGE as readonly string[]).includes(r.baggage)) draft.baggage = r.baggage as Baggage;
  const bags = intOr(r.checked_bags, null);
  if (draft.baggage === "Checked bags" && bags !== null && bags >= 1 && bags <= 9) draft.checkedBags = String(bags);
  draft.baggageNote = clean(r.baggage_note, 60);
  const rules = (Array.isArray(r.fare_rules) ? r.fare_rules : []).filter((x): x is string => typeof x === "string" && (FARE_RULES as readonly string[]).includes(x));
  draft.fareRules = [...new Set(rules)].join(", ");

  if (typeof r.budget_amount === "number" && Number.isFinite(r.budget_amount) && r.budget_amount > 0) {
    draft.budgetAmount = String(Math.round(r.budget_amount * 100) / 100);
    const cur = typeof r.budget_currency === "string" ? r.budget_currency.trim().toUpperCase() : "";
    draft.budgetCurrency = CURRENCY_RE.test(cur) ? cur : "USD";
  }
  draft.notes = (Array.isArray(r.notes) ? r.notes : []).map((n) => clean(n, 100)).filter(Boolean).slice(0, 8).join("\n");

  for (const q of Array.isArray(r.questions) ? r.questions : []) {
    if (typeof q === "string" && q.trim() && questions.length < 12) ask(q.trim().slice(0, 200));
  }
  return { draft, questions };
}

/* ── The agent's reviewed details (from the form, before saving) ──────────── */

/** Rebuilds a draft from what the browser sent: only known fields, only strings, sizes capped. */
export function draftFromInput(raw: unknown): FlightRequestDraft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string, max = 40) => (typeof r[k] === "string" ? (r[k] as string).slice(0, max) : "");
  const pick = <T extends string>(k: string, allowed: readonly T[], fallback: T) => ((allowed as readonly string[]).includes(s(k)) ? (s(k) as T) : fallback);
  const legs = (Array.isArray(r.legs) ? r.legs : []).slice(0, MAX_EXTRA_LEGS + 1).map((l) => {
    const x = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const str = (k: string) => (typeof x[k] === "string" ? (x[k] as string).slice(0, 20) : "");
    return { origin: str("origin"), destination: str("destination"), departOn: str("departOn") };
  });
  return {
    tripType: pick("tripType", TRIP_TYPES, "" as TripType),
    origin: s("origin"),
    destination: s("destination"),
    departOn: s("departOn"),
    returnOn: s("returnOn"),
    legs,
    flexibleDays: s("flexibleDays"),
    adults: s("adults"),
    children: s("children"),
    infants: s("infants"),
    cabin: pick("cabin", CABINS, "" as Cabin),
    stops: pick("stops", STOPS, "" as Stops),
    via: s("via"),
    maxConnectionHours: s("maxConnectionHours"),
    departTime: s("departTime"),
    returnTime: s("returnTime"),
    preferredAirlines: s("preferredAirlines", 60),
    baggage: pick("baggage", BAGGAGE, "" as Baggage),
    checkedBags: s("checkedBags"),
    baggageNote: s("baggageNote", 200),
    fareRules: s("fareRules", 100),
    budgetAmount: s("budgetAmount"),
    budgetCurrency: s("budgetCurrency") || "USD",
    notes: s("notes", 1200),
  };
}

export type DraftErrors = Partial<Record<keyof FlightRequestDraft, string>>;

export function validateDraft(v: FlightRequestDraft, today: string): DraftErrors {
  const e: DraftErrors = {};
  const origin = v.origin.trim().toUpperCase();
  const destination = v.destination.trim().toUpperCase();
  if (!(TRIP_TYPES as readonly string[]).includes(v.tripType)) e.tripType = "Choose one-way, return or multi-city.";
  if (!IATA_RE.test(origin)) e.origin = "3-letter airport or city code, e.g. DXB.";
  if (!IATA_RE.test(destination)) e.destination = "3-letter airport or city code, e.g. LHR.";
  else if (destination === origin) e.destination = "Arrival must differ from departure.";
  if (!isRealDate(v.departOn)) e.departOn = "Enter the departure date.";
  else if (v.departOn < today) e.departOn = "The departure date is in the past.";
  if (v.tripType === "Return") {
    if (!v.returnOn) e.returnOn = "Enter the return date, or choose one-way.";
    else if (!isRealDate(v.returnOn)) e.returnOn = "Enter a valid return date.";
    else if (isRealDate(v.departOn) && v.returnOn < v.departOn) e.returnOn = "The return is before the departure.";
  } else if (v.returnOn) e.returnOn = "Only a return trip has a return date.";

  if (v.tripType === "Multi-city") {
    if (!v.legs.length) e.legs = "Add at least one more flight, or choose one-way.";
    else if (v.legs.length > MAX_EXTRA_LEGS) e.legs = `At most ${MAX_EXTRA_LEGS + 1} flights.`;
    else {
      let previous = isRealDate(v.departOn) ? v.departOn : today;
      v.legs.forEach((l, i) => {
        if (e.legs) return;
        const o = l.origin.trim().toUpperCase();
        const d = l.destination.trim().toUpperCase();
        if (!IATA_RE.test(o) || !IATA_RE.test(d)) e.legs = `Flight ${i + 2}: 3-letter airport or city codes.`;
        else if (o === d) e.legs = `Flight ${i + 2}: arrival must differ from departure.`;
        else if (!isRealDate(l.departOn)) e.legs = `Flight ${i + 2}: enter the date.`;
        else if (l.departOn < previous) e.legs = `Flight ${i + 2}: the date is before the previous flight.`;
        else previous = l.departOn;
      });
    }
  } else if (v.legs.length) e.legs = "Only a multi-city trip has further flights.";

  if (!(FLEX_DAYS as readonly string[]).includes(v.flexibleDays)) e.flexibleDays = "Choose how flexible the dates are.";
  const n = (s: string) => (/^\d{1,2}$/.test(s.trim()) ? Number(s) : NaN);
  const adults = n(v.adults);
  const children = n(v.children);
  const infants = n(v.infants);
  if (!(adults >= 1 && adults <= 9)) e.adults = "1–9 adults.";
  if (!(children >= 0 && children <= 9)) e.children = "0–9 children.";
  if (!(infants >= 0 && infants <= 9)) e.infants = "0–9 infants.";
  else if (adults >= 1 && infants > adults) e.infants = "Each infant needs an adult.";
  if (!(CABINS as readonly string[]).includes(v.cabin)) e.cabin = "Choose a cabin.";

  if (!(STOPS as readonly string[]).includes(v.stops)) e.stops = "Choose the stops allowed.";
  const via = list(v.via);
  if (via.some((c) => !IATA_RE.test(c))) e.via = "3-letter airport codes, separated by commas.";
  else if (via.length > 3) e.via = "At most 3 connection airports.";
  else if (via.length && v.stops === "Direct only") e.via = "A direct flight has no connection airport.";
  if (v.maxConnectionHours.trim() && !(n(v.maxConnectionHours) >= 1 && n(v.maxConnectionHours) <= 24)) e.maxConnectionHours = "1–24 hours, or leave it empty.";
  if (v.departTime && !TIME_RE.test(v.departTime)) e.departTime = "Morning, Afternoon, Evening, Night, or e.g. After 18:00.";
  if (v.returnTime && !TIME_RE.test(v.returnTime)) e.returnTime = "Morning, Afternoon, Evening, Night, or e.g. After 18:00.";
  else if (v.returnTime && v.tripType !== "Return") e.returnTime = "Only a return trip has a return time.";

  const airlines = list(v.preferredAirlines);
  if (airlines.some((a) => !AIRLINE_RE.test(a))) e.preferredAirlines = "2-character airline codes, separated by commas (e.g. EK, QR).";

  if (!(BAGGAGE as readonly string[]).includes(v.baggage)) e.baggage = "Choose the baggage needed.";
  else if (v.baggage === "Checked bags" && v.checkedBags.trim() && !(n(v.checkedBags) >= 1 && n(v.checkedBags) <= 9)) e.checkedBags = "1–9 bags, or leave it empty.";
  else if (v.baggage !== "Checked bags" && v.checkedBags.trim()) e.checkedBags = "Only with checked bags.";
  if (v.baggageNote.length > 60) e.baggageNote = "Keep it under 60 characters.";
  const rules = v.fareRules.split(",").map((x) => x.trim()).filter(Boolean);
  if (rules.some((x) => !(FARE_RULES as readonly string[]).includes(x))) e.fareRules = "Choose from the listed fare conditions.";

  if (v.budgetAmount.trim()) {
    const b = Number(v.budgetAmount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(b) || b <= 0) e.budgetAmount = "Enter the budget as a number, or leave it empty.";
    if (!CURRENCY_RE.test(v.budgetCurrency.trim().toUpperCase())) e.budgetCurrency = "3-letter currency code.";
  }
  const notes = v.notes.split("\n").map((x) => x.trim()).filter(Boolean);
  if (notes.length > 8 || notes.some((x) => x.length > 100)) e.notes = "At most 8 notes of up to 100 characters.";
  return e;
}

/**
 * The flight_searches row for reviewed, approved details (provider stays "Manual": not searched by a supplier).
 * The first flight fills the table's columns; everything else is the customer's request, kept in `request`.
 * `aiActionId` is the reading's id in the log table (ai_actions); the name is kept for searches saved earlier.
 */
export function searchRow(v: FlightRequestDraft, aiActionId: string, questions: string[]) {
  const budget = v.budgetAmount.trim() ? Number(v.budgetAmount.replace(/[,\s]/g, "")) : null;
  const optionalInt = (s: string) => (s.trim() ? Number(s) : null);
  return {
    origin: v.origin.trim().toUpperCase(),
    destination: v.destination.trim().toUpperCase(),
    depart_on: v.departOn,
    return_on: v.tripType === "Return" ? v.returnOn || null : null,
    adults: Number(v.adults),
    children: Number(v.children),
    infants: Number(v.infants),
    cabin: v.cabin,
    request: {
      source: "Request reader, reviewed and approved by the agent",
      ai_action_id: aiActionId,
      trip_type: v.tripType,
      further_legs: v.tripType === "Multi-city"
        ? v.legs.map((l) => ({ origin: l.origin.trim().toUpperCase(), destination: l.destination.trim().toUpperCase(), depart_on: l.departOn }))
        : [],
      flexible_days: optionalInt(v.flexibleDays),
      stops: v.stops || null,
      via: list(v.via),
      max_connection_hours: optionalInt(v.maxConnectionHours),
      time_preferences: { outbound: v.departTime || null, return: v.returnTime || null },
      preferred_airlines: list(v.preferredAirlines),
      // The customer's requirements only: no allowance or fare condition is known until a supplier quotes.
      baggage_requested: v.baggage ? { need: v.baggage, checked_bags: optionalInt(v.checkedBags), note: v.baggageNote.trim() || null } : null,
      fare_conditions_requested: v.fareRules.split(",").map((x) => x.trim()).filter(Boolean),
      budget: budget === null ? null : { amount: budget, currency: v.budgetCurrency.trim().toUpperCase() },
      notes: v.notes.split("\n").map((x) => x.trim()).filter(Boolean),
      open_questions: questions,
      searched: false, // no live flight supplier connected: nothing was searched
    },
  };
}
