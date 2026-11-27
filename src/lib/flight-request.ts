// Reading a flight request: the agent types a trip request in plain words, the local reader
// (src/lib/flight-request-parser.ts, no AI service) turns it into search details, and the AGENT reviews
// and approves them before anything is saved. Pure, unit-tested.
//
// Rules this module enforces (the database repeats the important ones, migration 25):
//  • The reading has NO fields for fares, flights, schedules or availability, so none can be invented.
//    Nothing here ever shows a price except the budget the agent typed.
//  • No personal identification details in the request text (it is kept in the log): e-mail addresses,
//    phone / ID numbers, passport-style numbers and the linked customer's / lead's name are refused.
//  • Every value read is re-checked here; anything invalid becomes a question for the agent.

export const DAILY_LIMIT = 50; // readings per person per day (UTC); also enforced by the database
export const MAX_REQUEST_CHARS = 1000;
export const CABINS = ["Economy", "Premium economy", "Business", "First"] as const;
export type Cabin = (typeof CABINS)[number];

/** The search details the agent reviews (all strings, as in a form). */
export type FlightRequestDraft = {
  origin: string; // IATA airport or city code
  destination: string;
  departOn: string; // YYYY-MM-DD or ""
  returnOn: string; // YYYY-MM-DD or "" (one-way)
  adults: string;
  children: string;
  infants: string;
  cabin: Cabin;
  preferredAirlines: string; // 2-character codes, comma-separated
  budgetAmount: string; // the agent's own budget, never a fare
  budgetCurrency: string;
};

export const emptyDraft: FlightRequestDraft = {
  origin: "",
  destination: "",
  departOn: "",
  returnOn: "",
  adults: "1",
  children: "0",
  infants: "0",
  cabin: "Economy",
  preferredAirlines: "",
  budgetAmount: "",
  budgetCurrency: "USD",
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

/* ── Checking the reading ─────────────────────────────────────────────────── */

const IATA_RE = /^[A-Z]{3}$/;
const AIRLINE_RE = /^[A-Z0-9]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const intOr = (v: unknown, fallback: number | null) => (typeof v === "number" && Number.isInteger(v) ? v : fallback);

/**
 * Turns the reader's raw answer into a draft for the agent, keeping only valid values. Anything invalid or
 * missing is left blank (or at a safe default) with a question for the agent. Never throws.
 */
export function draftFromReading(raw: unknown, today: string): { draft: FlightRequestDraft; questions: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const questions: string[] = [];
  const ask = (q: string) => questions.includes(q) || questions.push(q);
  const draft: FlightRequestDraft = { ...emptyDraft };

  const code = (v: unknown, label: string) => {
    const s = typeof v === "string" ? v.trim().toUpperCase() : "";
    if (IATA_RE.test(s)) return s;
    ask(`Which ${label} airport or city?`);
    return "";
  };
  draft.origin = code(r.origin, "departure");
  draft.destination = code(r.destination, "arrival");
  if (draft.origin && draft.origin === draft.destination) {
    draft.destination = "";
    ask("Which arrival airport or city?");
  }

  const date = (v: unknown) => (typeof v === "string" && isRealDate(v) && v >= today ? v : "");
  draft.departOn = date(r.depart_on);
  if (!draft.departOn) ask("What is the departure date?");
  draft.returnOn = date(r.return_on);
  if (draft.returnOn && draft.departOn && draft.returnOn < draft.departOn) {
    draft.returnOn = "";
    ask("What is the return date?");
  }

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

  const airlines = Array.isArray(r.preferred_airlines)
    ? r.preferred_airlines.map((a) => (typeof a === "string" ? a.trim().toUpperCase() : "")).filter((a) => AIRLINE_RE.test(a))
    : [];
  draft.preferredAirlines = [...new Set(airlines)].slice(0, 6).join(", ");

  if (typeof r.budget_amount === "number" && Number.isFinite(r.budget_amount) && r.budget_amount > 0) {
    draft.budgetAmount = String(Math.round(r.budget_amount * 100) / 100);
    const cur = typeof r.budget_currency === "string" ? r.budget_currency.trim().toUpperCase() : "";
    draft.budgetCurrency = CURRENCY_RE.test(cur) ? cur : "USD";
  }

  for (const q of Array.isArray(r.questions) ? r.questions : []) {
    if (typeof q === "string" && q.trim() && questions.length < 8) ask(q.trim().slice(0, 200));
  }
  return { draft, questions };
}

/* ── Checking the agent's reviewed details (before saving) ────────────────── */

export function validateDraft(v: FlightRequestDraft, today: string) {
  const e: Partial<Record<keyof FlightRequestDraft, string>> = {};
  const origin = v.origin.trim().toUpperCase();
  const destination = v.destination.trim().toUpperCase();
  if (!IATA_RE.test(origin)) e.origin = "3-letter airport or city code, e.g. DXB.";
  if (!IATA_RE.test(destination)) e.destination = "3-letter airport or city code, e.g. LHR.";
  else if (destination === origin) e.destination = "Arrival must differ from departure.";
  if (!isRealDate(v.departOn)) e.departOn = "Enter the departure date.";
  else if (v.departOn < today) e.departOn = "The departure date is in the past.";
  if (v.returnOn && !isRealDate(v.returnOn)) e.returnOn = "Enter a valid return date, or leave it empty for one-way.";
  else if (v.returnOn && isRealDate(v.departOn) && v.returnOn < v.departOn) e.returnOn = "The return is before the departure.";
  const n = (s: string) => (/^\d{1,2}$/.test(s.trim()) ? Number(s) : NaN);
  const adults = n(v.adults);
  const children = n(v.children);
  const infants = n(v.infants);
  if (!(adults >= 1 && adults <= 9)) e.adults = "1–9 adults.";
  if (!(children >= 0 && children <= 9)) e.children = "0–9 children.";
  if (!(infants >= 0 && infants <= 9)) e.infants = "0–9 infants.";
  else if (adults >= 1 && infants > adults) e.infants = "Each infant needs an adult.";
  if (!(CABINS as readonly string[]).includes(v.cabin)) e.cabin = "Choose a cabin.";
  const airlines = v.preferredAirlines.split(",").map((a) => a.trim().toUpperCase()).filter(Boolean);
  if (airlines.some((a) => !AIRLINE_RE.test(a))) e.preferredAirlines = "2-character airline codes, separated by commas (e.g. EK, QR).";
  if (v.budgetAmount.trim()) {
    const b = Number(v.budgetAmount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(b) || b <= 0) e.budgetAmount = "Enter the budget as a number, or leave it empty.";
    if (!CURRENCY_RE.test(v.budgetCurrency.trim().toUpperCase())) e.budgetCurrency = "3-letter currency code.";
  }
  return e;
}

/**
 * The flight_searches row for reviewed, approved details (provider stays "Manual": not searched by a supplier).
 * `aiActionId` is the reading's id in the log table (ai_actions); the name is kept for searches saved earlier.
 */
export function searchRow(v: FlightRequestDraft, aiActionId: string, questions: string[]) {
  const airlines = v.preferredAirlines.split(",").map((a) => a.trim().toUpperCase()).filter(Boolean);
  const budget = v.budgetAmount.trim() ? Number(v.budgetAmount.replace(/[,\s]/g, "")) : null;
  return {
    origin: v.origin.trim().toUpperCase(),
    destination: v.destination.trim().toUpperCase(),
    depart_on: v.departOn,
    return_on: v.returnOn || null,
    adults: Number(v.adults),
    children: Number(v.children),
    infants: Number(v.infants),
    cabin: v.cabin,
    request: {
      source: "Request reader, reviewed and approved by the agent",
      ai_action_id: aiActionId,
      preferred_airlines: airlines,
      budget: budget === null ? null : { amount: budget, currency: v.budgetCurrency.trim().toUpperCase() },
      open_questions: questions,
      searched: false, // no live flight supplier connected: nothing was searched
    },
  };
}
