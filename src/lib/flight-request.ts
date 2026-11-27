// AI reading of a flight request: the agent types a trip request in plain words, the AI turns it into
// search details, and the AGENT reviews and approves them before anything is saved. Pure, unit-tested.
//
// Rules this module enforces (the database repeats the important ones, migration 25):
//  • The AI only reads the agent's words. Its output has NO fields for fares, flights, schedules or
//    availability, so it can't invent them. Nothing here ever shows a price except the budget the agent typed.
//  • No personal identification details are sent to the AI: e-mail addresses, phone / ID numbers,
//    passport-style numbers, and the names of the linked customer / lead are refused before sending.
//  • Everything the AI returns is re-checked here; anything invalid becomes a question for the agent.

export const AI_MODEL = "claude-opus-5-5";
export const DAILY_LIMIT = 50; // per person per day (UTC); also enforced by the database
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

/* ── What the AI is asked for ─────────────────────────────────────────────── */

/**
 * The only shape the AI may answer in (structured output). Deliberately no fare, price, flight number,
 * schedule or availability fields. Numeric and length limits are checked in code (not supported by the API).
 */
const orNull = (schema: Record<string, unknown>, description?: string) => ({
  anyOf: [schema, { type: "null" }],
  ...(description ? { description } : {}),
});

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    origin: orNull({ type: "string" }, "IATA airport or city code (3 letters) of departure, if stated or unambiguous"),
    destination: orNull({ type: "string" }, "IATA airport or city code (3 letters) of arrival, if stated or unambiguous"),
    depart_on: orNull({ type: "string", format: "date" }, "Departure date, if stated"),
    return_on: orNull({ type: "string", format: "date" }, "Return date, if stated; null for one-way or unknown"),
    adults: orNull({ type: "integer" }),
    children: orNull({ type: "integer" }),
    infants: orNull({ type: "integer" }),
    cabin: orNull({ type: "string", enum: [...CABINS] }),
    preferred_airlines: { type: "array", items: { type: "string" }, description: "2-character IATA airline codes the agent asked for" },
    budget_amount: orNull({ type: "number" }, "The total budget the agent stated, if any. Never a fare."),
    budget_currency: orNull({ type: "string" }, "3-letter currency code of the stated budget"),
    questions: { type: "array", items: { type: "string" }, description: "Short questions about anything missing or unclear" },
  },
  required: [
    "origin",
    "destination",
    "depart_on",
    "return_on",
    "adults",
    "children",
    "infants",
    "cabin",
    "preferred_airlines",
    "budget_amount",
    "budget_currency",
    "questions",
  ],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = [
  "You turn a travel agent's flight request into search details for a travel CRM.",
  "Only extract what the request says or makes unambiguous (e.g. 'Dubai' → DXB, 'London' → LON as a city code).",
  "Resolve relative or partial dates against today's date given in the message; never pick a date in the past.",
  "If something needed is missing or ambiguous (dates, airports, passenger counts, cabin), leave the field null",
  "and add a short question for the agent instead of guessing.",
  "Children are aged 2–11 and infants under 2. Default to 1 adult only if the request clearly concerns one traveller.",
  "You do not have access to fares, schedules or availability, and you must not mention or estimate any.",
  "Do not include names or other personal details in your answer.",
].join(" ");

export function userMessage(text: string, today: string) {
  return `Today's date: ${today}\n\nFlight request:\n${text}`;
}

/* ── Personal data must not be sent ───────────────────────────────────────── */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const DATE_LIKE_RE = /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g;
const NUMBER_RUN_RE = /\+?\d[\d\s().-]{5,}\d/g;
const PASSPORT_LIKE_RE = /\b[A-Za-z]{1,2}\d{6,9}\b/;

/** Why a request can't be sent to the AI as written, or null. Mirrors the database check (migration 25). */
export function personalDataProblem(text: string, linkedNames: string[] = []): string | null {
  if (EMAIL_RE.test(text)) return "Remove the e-mail address before asking the AI.";
  const withoutDates = text.replace(DATE_LIKE_RE, " ");
  for (const run of withoutDates.match(NUMBER_RUN_RE) ?? []) {
    if (run.replace(/\D/g, "").length >= 7) return "Remove phone numbers and ID numbers before asking the AI.";
  }
  if (PASSPORT_LIKE_RE.test(text)) return "Remove passport or other document numbers before asking the AI.";
  const words = new Set(text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z']+/).filter(Boolean));
  for (const full of linkedNames) {
    for (const part of full.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z']+/)) {
      if (part.length >= 3 && words.has(part)) return "Remove the customer's name: the AI only needs the trip details.";
    }
  }
  return null;
}

/** Checks the request text before anything is sent. */
export function requestTextProblem(text: unknown, linkedNames: string[] = []): string | null {
  if (typeof text !== "string" || !text.trim()) return "Describe the trip first.";
  if (text.length > MAX_REQUEST_CHARS) return `Keep the request under ${MAX_REQUEST_CHARS} characters.`;
  return personalDataProblem(text, linkedNames);
}

/* ── Checking the AI's reading ────────────────────────────────────────────── */

const IATA_RE = /^[A-Z]{3}$/;
const AIRLINE_RE = /^[A-Z0-9]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const intOr = (v: unknown, fallback: number | null) => (typeof v === "number" && Number.isInteger(v) ? v : fallback);

/**
 * Turns the AI's raw answer into a draft for the agent, keeping only valid values. Anything invalid or
 * missing is left blank (or at a safe default) with a question for the agent. Never throws.
 */
export function draftFromAi(raw: unknown, today: string): { draft: FlightRequestDraft; questions: string[] } {
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

/** The flight_searches row for reviewed, approved details (provider stays "Manual": not searched by a supplier). */
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
      source: "AI reading, reviewed and approved by the agent",
      ai_action_id: aiActionId,
      preferred_airlines: airlines,
      budget: budget === null ? null : { amount: budget, currency: v.budgetCurrency.trim().toUpperCase() },
      open_questions: questions,
      searched: false, // no live flight supplier connected: nothing was searched
    },
  };
}

/** Approximate cost of one reading at Claude Opus 5.5 list prices ($4 / $20 per million tokens). */
export function estimateCostUsd(inputTokens: number, outputTokens: number) {
  return Math.round(((inputTokens * 4 + outputTokens * 20) / 1_000_000) * 10_000) / 10_000;
}

/* ── When the AI service returns an error ─────────────────────────────────── */

/**
 * "rejected": the API refused the request itself (bad request, key, permission, model, size): trying again
 * won't help, an admin has to fix the setup. "unavailable": a timeout, rate limit, overload, server error or
 * lost connection (no status): trying again later can work.
 */
export function aiFailureReason(status: number | undefined): "rejected" | "unavailable" {
  if (status !== undefined && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) return "rejected";
  return "unavailable";
}

export type AiErrorFields = {
  status?: number;
  type?: string | null;
  errorCode?: string | null;
  requestID?: string | null;
  apiMessage?: string | null;
};

const KEY_LIKE_RE = /sk-ant-[\w-]+/g;

/**
 * One log line with Anthropic's own explanation of an error and the request ID its support can trace.
 * The API key travels only in a request header and is never part of an error response; anything key-like is
 * still masked, and the message is kept to one short line.
 */
export function aiErrorLog(e: AiErrorFields) {
  const message = (e.apiMessage ?? "").replace(KEY_LIKE_RE, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 300);
  return `status=${e.status ?? "none"} type=${e.type ?? "none"} code=${e.errorCode ?? "none"} request_id=${e.requestID ?? "none"} message="${message}"`;
}
