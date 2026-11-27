// Local flight-request reader: turns an agent's plain-words trip request into search details, entirely
// on our own server (no AI service, no network, no API key, no cost). Pure and unit-tested.
//
// It recognises patterns; it does not "understand" text. So whenever something is missing, unclear or
// could be read two ways, it leaves the field empty and adds a question for the agent instead of guessing.
// draftFromReading (src/lib/flight-request.ts) re-checks every value before the agent sees it.
// It has no fields for fares, availability, baggage allowances, PNRs or ticket numbers and can't produce
// them: baggage and fare conditions are only ever the customer's stated REQUIREMENTS.
import { CABINS, type Baggage, type Cabin, type Stops, type TripType } from "@/lib/flight-request";
import {
  AIRLINE_CODES,
  AIRLINES,
  AIRPORT_CODES,
  AMBIGUOUS_AIRLINE_CODES,
  AMBIGUOUS_PLACES,
  CODE_WORDS,
  CURRENCY_CODES,
  NOT_PLACES,
  PLACES,
  REGIONS,
} from "@/lib/travel-codes";

/** Stored as the "model" of each reading in the log (ai_actions), so readings stay traceable to the version. */
export const READER_VERSION = "local-parser-v2";

type LegReading = { origin: string | null; destination: string | null; depart_on: string | null };

export type FlightRequestReading = {
  trip_type: TripType | null;
  origin: string | null;
  destination: string | null;
  depart_on: string | null;
  return_on: string | null;
  legs: LegReading[]; // further flights of a multi-city trip
  flexible_days: number | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  cabin: Cabin | null;
  stops: Stops | null;
  via: string[];
  max_connection_hours: number | null;
  depart_time: string | null;
  return_time: string | null;
  preferred_airlines: string[];
  baggage: Baggage | null;
  checked_bags: number | null;
  baggage_note: string | null;
  fare_rules: string[];
  budget_amount: number | null;
  budget_currency: string | null;
  notes: string[];
  questions: string[];
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUM = "(\\d{1,2}|an?|one|two|three|four|five|six|seven|eight|nine|ten)";
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s] ?? NaN);

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** English, French, Spanish, German, Italian and Portuguese month names (no accents), and English abbreviations. */
const MONTH_WORDS: Record<string, number> = {};
[
  ["january", "jan", "janvier", "enero", "januar", "gennaio", "janeiro"],
  ["february", "feb", "fevrier", "febrero", "februar", "febbraio", "fevereiro"],
  ["march", "mar", "marzo", "marz"],
  ["april", "apr", "avril", "abril", "aprile"],
  ["may", "mayo", "maggio", "maio"],
  ["june", "jun", "juin", "junio", "juni", "giugno", "junho"],
  ["july", "jul", "juillet", "julio", "juli", "luglio", "julho"],
  ["august", "aug", "aout", "agosto"],
  ["september", "sept", "sep", "septembre", "septiembre", "setiembre", "settembre", "setembro"],
  ["october", "oct", "octobre", "octubre", "oktober", "ottobre", "outubro"],
  ["november", "nov", "novembre", "noviembre", "novembro"],
  ["december", "dec", "decembre", "diciembre", "dezember", "dicembre", "dezembro"],
].forEach((names, i) => names.forEach((n) => (MONTH_WORDS[n] = i + 1)));
const M = `(${Object.keys(MONTH_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
const monthOf = (s: string) => MONTH_WORDS[s] ?? 0;
const ORD = "(?:st|nd|rd|th|er|º|\.)?";
const Y = "(?:(?:,\\s*|\\s+|-)(\\d{4}|'\\d{2}))?";
const SEP = "\\s*(?:-|to|till|until|through|thru|au|al|bis)\\s*";
const PAX_WORDS = "adults?|adt|kids?|child(?:ren)?|chd|infants?|bab(?:y|ies)|inf|pax|people|persons?|passengers?|travell?ers?|guests?|seats?|tickets?|nights?|days?|weeks?|years?|yrs?|months?|bags?|pieces?|kg|kgs|hours?|hrs?|h|stops?";
const NOT_PAX = `(?!\\s*(?:${PAX_WORDS})\\b)`;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function addDays(iso: string, n: number) {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** The first date on or after `notBefore` with this month and day. */
function nextOccurrence(m: number, d: number, notBefore: string) {
  const y = Number(notBefore.slice(0, 4));
  const s = isoOf(y, m, d);
  return s >= notBefore ? s : isoOf(y + 1, m, d);
}
const yearOf = (s: string | undefined) => (!s ? undefined : s.startsWith("'") ? 2000 + Number(s.slice(1)) : s.length === 2 ? 2000 + Number(s) : Number(s));
const title = (s: string) => (s.length <= 3 ? s.toUpperCase() : s.replace(/(^|[\s-])[a-z]/g, (c) => c.toUpperCase()));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s-]+");
const clock = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** City names for codes, for questions ("DEL (Delhi)"). */
const CITY_OF: Record<string, string> = {};
for (const [name, code] of Object.entries(PLACES)) if (!(code in CITY_OF)) CITY_OF[code] = title(name);
const withCity = (code: string) => (CITY_OF[code] ? `${code} (${CITY_OF[code]})` : code);

/** The request in two forms of equal length: `orig` keeps capitals (for codes), `low` is lower-case. */
function prepare(input: string) {
  const orig = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*(?:→|->|=>|⇒|➔|➝|✈️?)\s*/g, " to ")
    .replace(/[–—]/g, "-")
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ");
  const low = orig
    .split("")
    .map((c) => (c.toLowerCase().length === 1 ? c.toLowerCase() : c))
    .join("");
  return { orig, low };
}

type Span = { start: number; end: number };

/* ── The reader ───────────────────────────────────────────────────────────── */

export function parseFlightRequest(input: string, today: string): FlightRequestReading {
  const { orig, low } = prepare(input);
  // `work` is `low` with every part already understood blanked out, so nothing is read twice.
  let work = low;
  const take = (start: number, end: number) => {
    work = work.slice(0, start) + " ".repeat(end - start) + work.slice(end);
  };
  const free = (start: number, end: number) => work.slice(start, end) === low.slice(start, end);
  const all = (pattern: string) => [...work.matchAll(new RegExp(pattern, "g"))];
  const takeAll = (pattern: string) => {
    const found = all(pattern);
    for (const m of found) take(m.index!, m.index! + m[0].length);
    return found;
  };

  const q = { route: [] as string[], dates: [] as string[], pax: [] as string[], other: [] as string[] };
  const ask = (list: string[], question: string) => list.includes(question) || list.push(question);
  const notes: string[] = [];
  const note = (n: string) => notes.includes(n) || notes.push(n);

  /* ── Things the reader must never make up: say so, don't guess ── */
  const fareTalk = low.replace(/\b(?:lowest|cheapest|best|flexible|flexi|refundable|non[\s-]?refundable|light|basic)\s+(?:fares?|prices?|tickets?|deals?)\b|\bfare\s+(?:rules?|conditions?|class|basis)\b|\blow[\s-]?cost\b/g, " ");
  if (/\b(?:fares?|prices?|how\s+much)\b/.test(fareTalk) && !/\bbudget\b/.test(low)) {
    ask(q.other, "Fares aren't shown here: they come from a flight supplier once one is connected.");
  }
  if (/\b(?:availability|available\s+seats?|seats?\s+available|is\s+there\s+space|sold\s+out)\b/.test(low)) {
    ask(q.other, "Seat availability isn't known here: it comes from a flight supplier once one is connected.");
  }
  if (/\b(?:pnr|booking\s+ref(?:erence)?|record\s+locator|e-?ticket|ticket\s+(?:number|no))\b/.test(low)) {
    ask(q.other, "PNRs and ticket numbers come from the airline after booking: this reading doesn't create or find them.");
  }

  /* ── Trip type words ── */
  const oneWay = /\bone[\s-]?way\b|\bsingle\s+(?:trip|journey|ticket|flight)\b|\bno\s+return\b|\bow\b|\bo\/w\b/.test(low);
  let roundTrip = /\breturn\b|\bround[\s-]?trip\b|\broundtrip\b|\brtn\b|\br\/t\b|\bthere\s+and\s+back\b|\band\s+back\b|\bback\s+(?:on|by)\b|\bcoming\s+back\b|\bboth\s+ways\b/.test(low);
  const multiWord = /\bmulti[\s-]?(?:city|cities|destination|leg|stop)\b|\bmultiple\s+(?:cities|destinations|legs)\b|\bopen[\s-]?jaw\b|\bseveral\s+(?:cities|legs|flights)\b/.test(low);

  /* ── Preferred airlines ── */
  const airlineHits: (Span & { code: string })[] = [];
  const preferBefore = (start: number) => /(?:\bprefer(?:s|red|ably)?|\bwith|\bon|\bfly(?:ing)?|\bairlines?:?|\bcarriers?:?|\bby|\bonly)\s*$/.test(low.slice(Math.max(0, start - 20), start));
  const chainedBefore = (start: number) => airlineHits.some((h) => h.end <= start && /^\s*(?:,|or|and|\/)\s*$/.test(low.slice(h.end, start)));
  const hitAirline = (code: string, start: number, end: number) => {
    airlineHits.push({ code, start, end });
    take(start, end);
  };
  const byLength = [...AIRLINES].sort((a, b) => b.name.length - a.name.length);
  for (const a of byLength.filter((x) => !x.context)) {
    for (const m of all(`\\b${escapeRe(a.name)}\\b`)) {
      const start = m.index!;
      if (a.name === "emirates" && /arab\s+$/.test(low.slice(Math.max(0, start - 6), start))) continue; // United Arab Emirates
      if (free(start, start + m[0].length)) hitAirline(a.code, start, start + m[0].length);
    }
  }
  for (const m of orig.matchAll(/\b([A-Z0-9]{2})\b/g)) {
    const start = m.index!;
    const code = m[1];
    if (!/[A-Z]/.test(code) || !AIRLINE_CODES.has(code) || !free(start, start + 2)) continue;
    if (AMBIGUOUS_AIRLINE_CODES.has(code) && !preferBefore(start) && !chainedBefore(start)) continue;
    hitAirline(code, start, start + 2);
  }
  for (const a of byLength.filter((x) => x.context)) {
    for (const m of all(`\\b${escapeRe(a.name)}\\b`)) {
      const start = m.index!;
      if (free(start, start + m[0].length) && (preferBefore(start) || chainedBefore(start))) hitAirline(a.code, start, start + m[0].length);
    }
  }
  const airlines: string[] = [];
  for (const h of airlineHits.sort((a, b) => a.start - b.start)) {
    if (/\b(?:not?|avoid|except|excluding|without|never|other\s+than)\b[^,.;]*$/.test(low.slice(Math.max(0, h.start - 25), h.start))) {
      note(`Avoid airline ${h.code}`);
    } else if (!airlines.includes(h.code)) airlines.push(h.code);
  }
  if (/\b(?:any|no\s+preference\s+(?:on|for)?\s*)\s*airlines?\b|\bairline\s+(?:doesn'?t|does\s+not)\s+matter\b/.test(low)) airlines.length = 0;

  /* ── Connections, stops and stopovers (before places, so "via DOH" is a connection, not a leg) ── */
  let stops: Stops | null = null;
  const stopWords: [RegExp, Stops][] = [
    [/\b(?:direct|non[\s-]?stop|nonstop)\b(?!\s+(?:me|us|them|debit|message))|\bno\s+(?:stops?|connections?|layovers?|transits?|stopovers?)\b/, "Direct only"],
    [/\b(?:max(?:imum)?|up\s+to|at\s+most)\s+(?:1|one)\s+(?:stop|connection|layover|transit)s?\b|\b(?:1|one|single)\s+(?:stop|connection|layover|transit)\s*(?:max(?:imum)?|only|ok|okay|fine|is\s+(?:ok|okay|fine))\b/, "Up to 1 stop"],
    [/\b(?:max(?:imum)?|up\s+to|at\s+most)\s+(?:2|two)\s+(?:stops|connections|layovers|transits)\b|\b(?:2|two)\s+(?:stops|connections)\s*(?:max(?:imum)?|ok|okay|fine)\b/, "Up to 2 stops"],
    [/\b(?:any\s+(?:number\s+of\s+)?(?:stops|connections)|(?:stops|connections|layovers|transits)\s+(?:are\s+)?(?:ok|okay|fine)|indirect\s+(?:is\s+)?(?:ok|okay|fine))\b/, "Any"],
  ];
  const stopsFound = stopWords.filter(([re]) => re.test(work)).map(([, s]) => s);
  if (stopsFound.length === 1) stops = stopsFound[0];
  else if (stopsFound.length > 1) ask(q.route, `How many stops are allowed: ${stopsFound.join(" or ")}?`);
  let maxConnectionHours: number | null = null;
  for (const m of takeAll("\\b(?:layovers?|connections?|transits?|stopovers?)\\s+(?:of\\s+|time\\s+)?(?:max(?:imum)?|under|below|less\\s+than|no\\s+(?:more|longer)\\s+than|up\\s+to|within)\\s+(\\d{1,2})\\s*(?:h|hrs?|hours?)\\b|\\b(?:max(?:imum)?|under|less\\s+than|no\\s+more\\s+than|up\\s+to)\\s+(\\d{1,2})\\s*(?:h|hrs?|hours?)\\s+(?:layovers?|connections?|transits?|stopovers?)\\b")) {
    maxConnectionHours = Number(m[1] ?? m[2]);
  }
  if (takeAll("\\b(?:short|quick|minimum|min)\\s+(?:layovers?|connections?|transits?)\\b").length) note("Short connections preferred");
  if (takeAll("\\bno\\s+overnight\\s+(?:layovers?|connections?|transits?|stops?)\\b|\\bnot?\\s+(?:an\\s+)?overnight\\s+(?:layover|connection|transit)\\b").length) note("No overnight connections");
  if (takeAll("\\bself[\\s-]?transfer\\b").length) note("Self-transfer connections: check the risks with the customer");
  if (/\btransit\s+visa\b|\bvisa\b/.test(low)) ask(q.other, "Visas and transit visas depend on the passengers' nationalities: check the rules for the route.");

  /* ── Places ── */
  type Place = Span & { code: string | null; label: string; question?: string; unknown?: true; joined?: true };
  const places: Place[] = [];
  const names = [...Object.keys(PLACES), ...Object.keys(AMBIGUOUS_PLACES), ...Object.keys(REGIONS)].sort((a, b) => b.length - a.length);
  for (const m of all(`\\b(?:${names.map(escapeRe).join("|")})\\b`)) {
    const start = m.index!;
    const end = start + m[0].length;
    const name = m[0].replace(/[\s-]+/g, " ");
    const previous = places[places.length - 1];
    if (name in REGIONS && previous && /^\s*,\s*$/.test(low.slice(previous.end, start))) {
      take(start, end); // "Abu Dhabi, United Arab Emirates": the country only qualifies the city
      continue;
    }
    if (name in PLACES) places.push({ start, end, code: PLACES[name], label: `${title(name)} (${PLACES[name]})` });
    else if (name in AMBIGUOUS_PLACES) places.push({ start, end, code: null, label: title(name), question: AMBIGUOUS_PLACES[name] });
    else places.push({ start, end, code: null, label: title(name), question: `Which airport in ${title(name)}: ${REGIONS[name].map(withCity).join(", ")}?` });
    take(start, end);
  }
  // Two codes typed together, as in a booking system: "DXBLHR".
  for (const m of orig.matchAll(/\b([A-Z]{3})([A-Z]{3})\b/g)) {
    const start = m.index!;
    if (AIRPORT_CODES.has(m[1]) && AIRPORT_CODES.has(m[2]) && free(start, start + 6)) {
      places.push({ start, end: start + 3, code: m[1], label: m[1] }, { start: start + 3, end: start + 6, code: m[2], label: m[2], joined: true });
      take(start, start + 6);
    }
  }
  for (const m of orig.matchAll(/\b([A-Za-z]{3})\b/g)) {
    const start = m.index!;
    const end = start + 3;
    const token = m[1];
    const code = token.toUpperCase();
    if (!free(start, end)) continue;
    if (token === code) {
      if (NOT_PLACES.has(code)) continue;
      // An unknown code in capitals is kept (the agent may know it) but checked with the agent.
      places.push({ start, end, code, label: code, ...(AIRPORT_CODES.has(code) ? {} : { unknown: true as const }) });
    } else {
      // Typed in lower case: only a known code, not an English word, right next to "to" / "from" / "-".
      const adjacent = /(?:\bto|\bfrom|\bex|\bvia|-|\/)\s*$/.test(low.slice(Math.max(0, start - 6), start)) || /^\s*(?:to\b|-|\/)/.test(low.slice(end, end + 4));
      if (!AIRPORT_CODES.has(code) || CODE_WORDS.has(token.toLowerCase()) || !adjacent) continue;
      places.push({ start, end, code, label: code });
    }
    take(start, end);
  }
  places.sort((a, b) => a.start - b.start);
  for (const p of places.filter((x) => x.unknown)) ask(q.route, `${p.code} isn't in the airport list: check the code.`);

  type Role = "from" | "to" | "via" | "back" | "none";
  const roleOf = (p: Place, prev: Place | undefined): Role => {
    const before = low.slice(Math.max(prev ? prev.end : 0, p.start - 30), p.start).replace(/\bthe\s*$/, "");
    if (/\b(?:via|through|thru|stop(?:ping|over)?(?:\s+(?:in|at))?|connect(?:ing|ion)?\s+(?:in|at|through|via)|transit(?:ing)?(?:\s+(?:in|at|through|via))?|layover\s+(?:in|at)|change\s+(?:planes?\s+)?(?:in|at))\s*$/.test(before)) return "via";
    if (/\bback\s+(?:to|home\s+to)\s*$/.test(before)) return "back";
    if (/(?:\bfrom|\bex|\bleaving|\bdeparting|\bout\s+of|\bstarting\s+(?:in|from)|\bfly(?:ing)?\s+out\s+of)\s*$/.test(before)) return "from";
    if (/(?:\bto|\binto|\btowards?|\bon\s+to|\bonward\s+to|\barriving\s+(?:in|at)|\bdestination:?)\s*$/.test(before)) return "to";
    if (prev && (/^\s*[-/]\s*$/.test(low.slice(prev.end, p.start)) || (p.joined && prev.end === p.start))) return "to";
    return "none";
  };
  const roles = places.map((p, i) => ({ ...p, role: roleOf(p, places[i - 1]) }));

  // Stops the customer asked for: connections (via) and multi-night stopovers (a separate flight).
  const via: string[] = [];
  for (const p of roles.filter((r) => r.role === "via")) {
    const around = low.slice(Math.max(0, p.start - 30), Math.min(low.length, p.end + 25));
    const nights = /(\d{1,2}|an?|one|two|three|four|five|six|seven)[\s-]+nights?|\bovernight\b/.exec(around);
    if (/stopover/.test(around) && nights) {
      ask(q.route, `A stopover of a night or more in ${p.label} is a separate flight: add it as a multi-city trip.`);
      const span = new RegExp(`for\\s+${nights[0].replace(/\s+/g, "\\s+")}`).exec(work.slice(p.end, p.end + 25));
      if (span) take(p.end + span.index, p.end + span.index + span[0].length);
    } else if (p.code) {
      if (!via.includes(p.code)) via.push(p.code);
    } else if (p.question) ask(q.route, p.question);
  }
  if (via.length && stops === "Direct only") ask(q.route, `A direct flight can't connect in ${via.join(", ")}: which is it?`);

  // Flights: each "to" place ends a flight that starts at the place before it.
  type Hit = (typeof roles)[number];
  const flights: { from: Hit | null; to: Hit; back?: true }[] = [];
  let pending: Hit | null = null;
  const unused: Hit[] = [];
  for (const h of roles.filter((r) => r.role !== "via")) {
    if (h.role === "from") {
      const open = flights.find((f) => !f.from && f.to.end <= h.start);
      if (open) open.from = h;
      else {
        if (pending) unused.push(pending);
        pending = h;
      }
    } else if (h.role === "to" || h.role === "back") {
      const from = pending ?? (flights.length ? flights[flights.length - 1].to : null);
      if (from?.code && from.code === h.code) {
        pending = h; // "… to London, then London to Paris": the same place again starts the next flight
        continue;
      }
      flights.push({ from, to: h, ...(h.role === "back" ? { back: true as const } : {}) });
      pending = null;
    } else if (pending && pending.role === "none" && !flights.length) {
      // Two places with nothing between them ("Dubai London"): read in the order written, then checked.
      flights.push({ from: pending, to: h });
      ask(q.route, `Check the direction: it was read as ${pending.label} → ${h.label}.`);
      pending = null;
    } else {
      if (pending) unused.push(pending);
      pending = h;
    }
  }
  if (pending) {
    if (!flights.length) ask(q.route, `Is ${pending.label} the departure or the arrival?`);
    else if (!flights.some((f) => f.from === pending || f.to === pending)) unused.push(pending);
  }
  for (const f of flights) {
    for (const p of [f.from, f.to]) if (p?.question) ask(q.route, p.question);
  }
  if (!flights.length) for (const p of roles) if (p.role !== "via" && p.question) ask(q.route, p.question);
  if (unused.length) ask(q.route, `The request also mentions ${unused.map((u) => u.label).join(", ")}: is that part of the trip?`);

  const codeOf = (h: Hit | null) => h?.code ?? null;
  let tripType: TripType | null = null;
  let returnFlight = false;
  let legs = flights;
  const reversed = (a: (typeof flights)[number], b: (typeof flights)[number]) => !!codeOf(a.to) && codeOf(b.from) === codeOf(a.to) && codeOf(b.to) === codeOf(a.from);
  if (flights.length === 2 && reversed(flights[0], flights[1])) {
    returnFlight = true; // "Dubai to London and back to Dubai", "DXB-LHR-DXB"
    legs = [flights[0]];
  } else if (flights.length >= 2) {
    tripType = "Multi-city";
    if (flights.length > 6) {
      ask(q.route, "A multi-city search holds at most 6 flights: save the rest as another search.");
      legs = flights.slice(0, 6);
    }
  }
  if (returnFlight) roundTrip = true;
  if (oneWay && (returnFlight || tripType === "Multi-city")) ask(q.route, "The request says one-way but describes more than one flight: which is it?");
  if (multiWord && tripType !== "Multi-city") {
    tripType = "Multi-city";
    ask(q.route, "List each flight of the multi-city trip (from, to, date).");
  }
  const first = legs[0];

  /* ── Budget (before dates, so "9,000" or "12.500" is never read as a date) ── */
  type Money = Span & { amount: number; currency: string | null; word: string };
  const money: Money[] = [];
  const AMT = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(?!\\d|,\\d)(?:\\s*(k|thousand|grand)\\b)?";
  const amountOf = (n: string, suffix: string | undefined) => {
    let s = n.replace(/,/g, "");
    if (!suffix && /^\d+\.\d{3}$/.test(s)) s = s.replace(".", ""); // 12.500 = twelve thousand five hundred
    return Number(s) * (suffix ? 1000 : 1);
  };
  const currencyOf = (w: string): string | null => {
    const s = w.toLowerCase().replace(/\.$/, "");
    if (CURRENCY_CODES.includes(s.toUpperCase())) return s.toUpperCase();
    const words: Record<string, string> = {
      $: "USD", dollar: "USD", dollars: "USD", bucks: "USD", "£": "GBP", pound: "GBP", pounds: "GBP", quid: "GBP", "€": "EUR",
      euro: "EUR", euros: "EUR", "₹": "INR", dirham: "AED", dirhams: "AED", dhs: "AED", dh: "AED", lira: "TRY", yen: "JPY",
      "¥": "JPY", yuan: "CNY", rmb: "CNY", ringgit: "MYR", baht: "THB", naira: "NGN", taka: "BDT", rand: "ZAR",
    };
    return words[s] ?? null; // rupees, riyals, dinars, francs: more than one currency uses the name
  };
  const codes = CURRENCY_CODES.map((c) => c.toLowerCase()).join("|");
  const WORDS = "dollars?|bucks|dirhams?|dhs?|euros?|pounds?|quid|rupees?|rs|riyals?|rials?|dinars?|francs?|lira|yen|yuan|rmb|ringgit|baht|naira|taka|rand";
  const addMoney = (m: RegExpMatchArray, num: string, suffix: string | undefined, word: string) => {
    const start = m.index!;
    const end = start + m[0].length;
    if (!free(start, end)) return;
    money.push({ start, end, amount: amountOf(num, suffix), currency: currencyOf(word), word });
    take(start, end);
  };
  for (const m of all(`(?:([$£€₹¥])|\\b(${codes}|dhs?|rs)\\.?)\\s*${AMT}`)) addMoney(m, m[3], m[4], m[1] ?? m[2]);
  for (const m of all(`\\b${AMT}\\s*(${codes}|${WORDS})\\b`)) addMoney(m, m[1], m[2], m[3]);
  if (!money.length) {
    const lead = "\\b(?:budget|max(?:imum)?\\s+(?:budget|spend)|spend|up\\s+to|no\\s+more\\s+than|not\\s+more\\s+than|less\\s+than)(?:\\s+(?:is|of|around|about|approx\\w*|max(?:imum)?|under|below|~))*\\s*:?\\s*";
    for (const m of all(`${lead}${AMT}${NOT_PAX}(?!\\s*(?:st|nd|rd|th)\\b)(?!\\s*(?:-|/|of)?\\s*${M}\\b)`)) {
      if (amountOf(m[1], m[2]) >= 10) addMoney(m, m[1], m[2], "");
    }
  }
  let budgetAmount: number | null = null;
  let budgetCurrency: string | null = null;
  const fmt = (x: Money) => `${x.currency ?? ""} ${x.amount.toLocaleString("en-US")}`.trim();
  const distinct = money.filter((x, i) => money.findIndex((y) => y.amount === x.amount && y.currency === x.currency) === i);
  if (distinct.length > 1) ask(q.other, `Which budget: ${distinct.map(fmt).join(" or ")}?`);
  else if (distinct.length === 1) {
    const b = distinct[0];
    budgetAmount = b.amount;
    budgetCurrency = b.currency;
    if (!b.currency) ask(q.other, b.word ? `Which currency is the budget in? "${b.word}" could mean more than one.` : "Which currency is the budget in?");
    if (/^\s*(?:per\s+(?:person|pax|head|adult|passenger)|pp\b|p\.p\.|each)/.test(low.slice(b.end, b.end + 20))) {
      ask(q.other, `Is the budget of ${fmt(b)} per person or for the whole trip? It was read as the total.`);
    }
  }

  /* ── Baggage: the customer's needs only, never an allowance ── */
  let baggage: Baggage | null = null;
  let checkedBags: number | null = null;
  const bagNotes: string[] = [];
  if (takeAll("\\b(?:hand\\s+luggage|hand\\s+baggage|cabin\\s+(?:bags?|baggage|luggage)|carry[\\s-]?on|backpack)\\s+only\\b|\\bno\\s+(?:checked|hold|check[\\s-]?in)\\s+(?:bags?|baggage|luggage)\\b|\\bwithout\\s+(?:checked\\s+|hold\\s+)?(?:bags?|baggage|luggage)\\b|\\blight\\s+fare\\b").length) baggage = "Cabin bag only";
  for (const m of takeAll(`\\b(\\d{1,2}|one|two|three|four|five|six)\\s*(?:x\\s*)?(?:checked\\s+|hold\\s+|check[\\s-]?in\\s+)?(?:bags?|suitcases?|pieces?(?:\\s+of\\s+(?:luggage|baggage))?|luggage\\s+pieces?)\\b(?:\\s*(?:of|x|@)?\\s*(\\d{2})\\s*kgs?\\b)?`)) {
    const n = toNum(m[1]);
    if (Number.isFinite(n) && n >= 1) {
      baggage = baggage === "Cabin bag only" ? null : "Checked bags";
      checkedBags = n;
      if (m[2]) bagNotes.push(`${n} × ${m[2]} kg`);
    }
  }
  for (const m of takeAll("\\b(\\d{1,2})\\s*x\\s*(\\d{2})\\s*kgs?\\b|\\b(\\d{2,3})\\s*kgs?\\b")) {
    if (m[1]) {
      checkedBags = checkedBags ?? Number(m[1]);
      bagNotes.push(`${m[1]} × ${m[2]} kg`);
    } else bagNotes.push(`${m[3]} kg`);
    if (baggage !== "Cabin bag only") baggage = "Checked bags";
  }
  if (takeAll("\\b(?:with|incl(?:uding|\\.)?|plus|need(?:s)?|needs\\s+a|require[sd]?)\\s+(?:a\\s+)?(?:checked|hold|check[\\s-]?in)?\\s*(?:bags?|baggage|luggage|suitcases?)\\b|\\b(?:checked|hold)\\s+(?:bags?|baggage|luggage)\\s+(?:needed|required|please|included)\\b|\\bextra\\s+(?:bags?|baggage|luggage)\\b").length && baggage === null) baggage = "Checked bags";
  if (/\b(?:baggage|luggage|bag)\s+allowance\b|\bhow\s+(?:much|many)\s+(?:baggage|luggage|bags?|kg)\b|\b(?:baggage|luggage|bags?)\s+included\b|\bis\s+(?:baggage|luggage)\s+(?:included|free)\b/.test(low)) {
    ask(q.other, "Baggage allowances depend on the airline and fare, so they can't be confirmed until a fare is quoted.");
  }
  if (baggage === null && checkedBags !== null) ask(q.other, "Cabin bag only, or checked bags? The request mentions both.");
  const baggageNote = bagNotes.length ? [...new Set(bagNotes)].join(", ") : null;
  if (/\b(?:golf(?:\s+(?:clubs?|bags?))?|skis?|snowboards?|bikes?|bicycles?|surfboards?|diving\s+(?:gear|equipment)|sports?\s+equipment)\b/.test(work)) {
    note("Sports equipment to check in: confirm the airline's rules");
  }
  if (/\b(?:musical\s+instrument|guitar|cello|violin)\b/.test(work)) note("Musical instrument: confirm the airline's rules");

  /* ── Fare conditions: the customer's requests, never a confirmed rule ── */
  const fareRules: string[] = [];
  const wantRule = (r: string) => fareRules.includes(r) || fareRules.push(r);
  if (takeAll("\\bnon[\\s-]?refundable\\s+(?:is\\s+|are\\s+)?(?:ok|okay|fine|acceptable)\\b|\\brestrictions?\\s+(?:are\\s+|is\\s+)?(?:ok|okay|fine)\\b|\\bbasic\\s+economy\\b").length) wantRule("Restrictions OK");
  if (/\b(?:fully\s+)?refundable\b/.test(work.replace(/\bnon[\s-]?refundable\b/g, ""))) wantRule("Refundable");
  if (/\bnon[\s-]?refundable\b/.test(work) && !fareRules.includes("Restrictions OK")) wantRule("Restrictions OK");
  if (takeAll("\\bchangeable\\b|\\bamendable\\b|\\bflexible\\s+(?:tickets?|fares?|booking)\\b|\\bflexi\\s+(?:tickets?|fares?)\\b|\\bfree\\s+(?:date\\s+)?changes?\\b|\\bno\\s+change\\s+fees?\\b|\\b(?:date\\s+)?changes?\\s+allowed\\b|\\bopen\\s+(?:dated?\\s+)?return\\b").length) wantRule("Changeable");
  if (/\b(?:cheapest|lowest\s+(?:fare|price|cost)|best\s+(?:price|fare|deal)|low[\s-]?cost|budget\s+airlines?|as\s+cheap\s+as\s+possible)\b/.test(work)) wantRule("Lowest fare");
  if (fareRules.includes("Refundable") && (fareRules.includes("Lowest fare") || fareRules.includes("Restrictions OK"))) {
    ask(q.other, "Refundable fares usually cost more than the lowest fare. Which matters more?");
  }
  if (/\b(?:fare\s+rules?|fare\s+conditions?|cancellation\s+(?:policy|fees?|charges?)|change\s+(?:fees?|penalt\w+)|penalt(?:y|ies))\b/.test(low) && !fareRules.includes("Changeable")) {
    ask(q.other, "Fare rules (changes, refunds, penalties) depend on the fare. Check them when a fare is quoted.");
  }

  /* ── Date flexibility ── */
  let flexibleDays: number | null = null;
  const flexNum = `(\\d|one|two|three|four|five|six|seven)`;
  for (const m of takeAll(`(?:\\+\\s*\\/?\\s*-|±|plus\\s+or\\s+minus|plus\\/minus|give\\s+or\\s+take)\\s*${flexNum}\\s*(?:days?|d)\\b|\\b${flexNum}\\s*days?\\s+(?:either\\s+(?:side|way)|before\\s+or\\s+after|flexib\\w*)\\b|\\bflexib\\w*\\s+(?:by\\s+|on\\s+|with\\s+|for\\s+)?(?:up\\s+to\\s+|about\\s+)?${flexNum}\\s*days?\\b`)) {
    flexibleDays = toNum(m[1] ?? m[2] ?? m[3]);
  }
  if (takeAll("\\b(?:exact|fixed)\\s+dates?\\b|\\bdates?\\s+(?:are\\s+)?(?:fixed|exact|not\\s+flexible)\\b|\\bno\\s+flexibility\\b|\\bnot\\s+flexible\\b").length) flexibleDays = 0;
  if (flexibleDays === null) {
    if (takeAll("\\bflexib\\w*\\s+(?:on\\s+|with\\s+)?(?:the\\s+)?dates?\\b|\\bdates?\\s+(?:are\\s+)?flexib\\w*\\b|\\bflex\\s+dates?\\b|\\bflexible\\s+(?:travel|timing)\\b").length) {
      ask(q.dates, "How many days either side are the dates flexible?");
    } else if (/\bflex(?:ible|i)?\b/.test(work)) ask(q.dates, "Flexible dates, or a changeable ticket? \"Flexible\" can mean either.");
  }

  /* ── Time of day (before dates: "after 18:00" is not a date) ── */
  const times: { start: number; value: string | null; arrive: boolean; raw: string }[] = [];
  takeAll("\\bgood\\s+(?:morning|afternoon|evening|night)\\b");
  for (const m of all(`\\b(?:(arriv\\w*|land\\w*|reach\\w*|get\\s+there|be\\s+there)\\s+)?(after|before|by|not\\s+before|not\\s+later\\s+than|not\\s+after|no\\s+earlier\\s+than|no\\s+later\\s+than|from|around|at|about)\\s+(\\d{1,2})(?:[:.h]([0-5]\\d))?\\s*(am|pm|a\\.m\\.|p\\.m\\.|hrs|h)?(?![\\d/.-])(?!\\s*(?:${M}|st|nd|rd|th|er|${PAX_WORDS})\\b)|\\b(?:(arriv\\w*|land\\w*)\\s+)?(after|before|by)\\s+(noon|midday|midnight)\\b`)) {
    const arrive = !!(m[1] ?? m[6]);
    const word = (m[2] ?? m[7]).replace(/\s+/g, " ");
    let value: string | null = null;
    if (m[8]) value = m[8] === "midnight" ? "00:00" : "12:00";
    else {
      let h = Number(m[3]);
      const min = m[4] ? Number(m[4]) : 0;
      const ampm = m[5]?.replace(/\./g, "");
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
      if (h > 23) continue;
      // A bare number after "from" / "at" / "around" is often not a time at all ("from 2", "at 5").
      if (!ampm && !m[4] && ["from", "at", "about", "around"].includes(word)) continue;
      if (!ampm && !m[4] && h <= 12) {
        // "after 6": 06:00 or 18:00?
        take(m.index!, m.index! + m[0].length);
        ask(q.dates, `Is "${m[0].trim()}" in the morning or the evening?`);
        continue;
      }
      value = clock(h, min);
    }
    const kind = /^(?:after|not before|no earlier than|from)$/.test(word) ? "After" : /^(?:before|by|not later than|not after|no later than)$/.test(word) ? "Before" : "Around";
    take(m.index!, m.index! + m[0].length);
    if (arrive) {
      note(`Arrive ${kind === "Before" ? "by" : kind.toLowerCase()} ${value}`);
      continue;
    }
    if (kind === "Around") {
      ask(q.dates, `Departure around ${value}: should it be "after" or "before" that time?`);
      continue;
    }
    times.push({ start: m.index!, value: `${kind} ${value}`, arrive, raw: m[0] });
  }
  for (const m of all("\\b(?:(arriv\\w*|land\\w*)\\s+(?:in\\s+the\\s+|by\\s+|in\\s+)?)?(?:early\\s+|late\\s+)?(morning|afternoon|evening|night|overnight|red[\\s-]?eye|late[\\s-]night)(?:\\s+(?:flights?|departures?|dep))?\\b")) {
    const word = m[2];
    if (word === "night" && /(?:\d|\bper|\bone|\btwo|\bthree)\s*-?\s*$/.test(low.slice(Math.max(0, m.index! - 8), m.index!))) continue; // "2 night stopover", "per night"
    const slot = word === "morning" ? "Morning" : word === "afternoon" ? "Afternoon" : word === "evening" ? "Evening" : "Night";
    take(m.index!, m.index! + m[0].length);
    if (m[1]) note(`Arrive in the ${slot.toLowerCase()}`);
    else times.push({ start: m.index!, value: slot, arrive: false, raw: m[0] });
  }

  /* ── Dates ── */
  type When = Span & { y?: number; m?: number; d?: number; abs?: string; unclear?: true; pair?: "out" | "back" };
  const dates: When[] = [];
  const addDate = (m: RegExpMatchArray, w: Omit<When, "start" | "end">, start = m.index!, end = m.index! + m[0].length) => {
    if (!free(start, end)) return;
    dates.push({ start, end, ...w });
    take(start, end);
  };
  const addPair = (m: RegExpMatchArray, a: Omit<When, "start" | "end">, b: Omit<When, "start" | "end">) => {
    if (!free(m.index!, m.index! + m[0].length)) return;
    take(m.index!, m.index! + m[0].length);
    dates.push({ start: m.index!, end: m.index! + 1, ...a, pair: "out" }, { start: m.index! + 1, end: m.index! + m[0].length, ...b, pair: "back" });
  };
  // A short weekday next to a date ("Fri 15 Jan", "Thu, 15/01") only names that date.
  takeAll("\\b(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\\.?,?\\s+(?=\\d)");
  // Two dates in one phrase: "15-29 Jan", "Jan 15 to 29".
  for (const m of all(`\\b(\\d{1,2})${ORD}${SEP}(\\d{1,2})${ORD}(?:\\s+|-)(?:of\\s+|de\\s+)?${M}\\b${Y}`)) {
    const mo = monthOf(m[3]);
    const y = yearOf(m[4]);
    addPair(m, { y, m: mo, d: Number(m[1]) }, { y, m: mo, d: Number(m[2]) });
  }
  for (const m of all(`\\b${M}\\.?\\s+(\\d{1,2})${ORD}${SEP}(\\d{1,2})${ORD}\\b${NOT_PAX}${Y}`)) {
    const mo = monthOf(m[1]);
    const y = yearOf(m[4]);
    addPair(m, { y, m: mo, d: Number(m[2]) }, { y, m: mo, d: Number(m[3]) });
  }
  for (const m of all("\\b(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})\\b")) addDate(m, { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  // Booking-system style: "15JAN27".
  for (const m of all(`\\b(\\d{1,2})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\\d{2})\\b`)) addDate(m, { y: yearOf(m[3]), m: monthOf(m[2]), d: Number(m[1]) });
  for (const m of all(`\\b(\\d{1,2})\\.(\\d{1,2})\\.(?!\\d)|\\b(\\d{1,2})([/.-])(\\d{1,2})(?:\\4(\\d{4}|\\d{2}))?\\b${NOT_PAX}(?![.,]\\d)`)) {
    const german = m[1] !== undefined; // "15.01." is always day.month
    if (!german && m[4] !== "/" && !m[6]) continue; // "2-3" or "9.5" alone are not dates
    const a = Number(german ? m[1] : m[3]);
    const b = Number(german ? m[2] : m[5]);
    const y = yearOf(m[6]);
    if (german) {
      if (b >= 1 && b <= 12) addDate(m, { m: b, d: a });
    } else if (a > 12 && b >= 1 && b <= 12) addDate(m, { y, m: b, d: a });
    else if (b > 12 && a >= 1 && a <= 12) addDate(m, { y, m: a, d: b });
    else if (a === b && a >= 1) addDate(m, { y, m: a, d: a });
    else if (a >= 1 && b >= 1 && a <= 12 && b <= 12) {
      addDate(m, { unclear: true });
      ask(q.dates, `Is ${m[0]} ${a} ${MONTH_NAMES[b - 1]} (day/month) or ${MONTH_NAMES[a - 1]} ${b} (month/day)?`);
    }
  }
  for (const m of all(`\\b(\\d{1,2})${ORD}(?:\\s+|-)?(?:of\\s+|de\\s+)?${M}\\b\\.?${Y}`)) addDate(m, { y: yearOf(m[3]), m: monthOf(m[2]), d: Number(m[1]) });
  for (const m of all(`\\b${M}\\.?(?:\\s+|-)(?:the\\s+)?(\\d{1,2})${ORD}\\b${NOT_PAX}${Y}`)) addDate(m, { y: yearOf(m[3]), m: monthOf(m[1]), d: Number(m[2]) });
  for (const m of all("\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\b(?!\\s*(?:class|time|week|leg|flight|floor|row|bag|stop)\\b)")) addDate(m, { d: Number(m[1]) });
  for (const m of all("\\b(?:the\\s+)?day\\s+after\\s+tomorrow\\b")) addDate(m, { abs: addDays(today, 2) });
  for (const m of all("\\btomorrow\\b")) addDate(m, { abs: addDays(today, 1) });
  for (const m of all("\\b(?:today|tonight)\\b")) addDate(m, { abs: today });
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  for (const m of all(`\\b(?:(next|this|coming|on)\\s+)?(${WEEKDAYS.join("|")})\\b`)) {
    const end = m.index! + m[0].length;
    if (dates.some((w) => Math.abs(w.start - end) <= 3 || Math.abs(m.index! - w.end) <= 3)) {
      take(m.index!, end); // "Friday 15 January": the weekday only names the date beside it
      continue;
    }
    const abs = addDays(today, (WEEKDAYS.indexOf(m[2]) - todayDow + 7) % 7 || 7);
    addDate(m, { abs });
    if (m[1] === "next") ask(q.dates, `Check the date: "${m[0]}" was read as ${abs}.`);
  }
  for (const m of all(`\\bin\\s+${NUM}\\s+(days?|weeks?|fortnights?)\\b`)) {
    const n = toNum(m[1]);
    if (n) addDate(m, { abs: addDays(today, n * (m[2].startsWith("fortnight") ? 14 : m[2].startsWith("week") ? 7 : 1)) });
  }
  let stay: { days: number; label: string; exact: boolean } | null = null;
  for (const m of all(`\\bfor\\s+${NUM}\\s+(nights?|days?|weeks?|fortnights?)\\b|\\b(\\d{1,2})[\\s-](nights?|days?|weeks?)\\s+(?:trip|stay|holiday|vacation|break)\\b|\\b(?:stay(?:ing)?|holiday|vacation)\\s+(?:of\\s+)?${NUM}\\s+(nights?|days?|weeks?)\\b`)) {
    const n = toNum(m[1] ?? m[3] ?? m[5]);
    const unit = m[2] ?? m[4] ?? m[6];
    if (!n || stay) continue;
    stay = { days: n * (unit.startsWith("fortnight") ? 14 : unit.startsWith("week") ? 7 : 1), label: m[0].replace(/^(?:for|staying|stay|holiday|vacation)\s+(?:of\s+)?/, ""), exact: !unit.startsWith("day") };
    take(m.index!, m.index! + m[0].length);
  }
  for (const m of all("\\b(?:next\\s+(?:week|month|weekend)|this\\s+(?:week|weekend|month)|end\\s+of\\s+(?:the\\s+|this\\s+|next\\s+)?month|asap|as\\s+soon\\s+as\\s+possible|(?:eid|christmas|easter|ramadan|diwali|new\\s+year|summer|winter)(?:\\s+(?:holidays?|break|vacation))?|school\\s+(?:holidays?|break|vacation))\\b")) {
    ask(q.dates, `Which date? The request only says "${m[0].trim()}".`);
    take(m.index!, m.index! + m[0].length);
  }
  for (const m of all(`\\b(?:(?:early|mid|late|end\\s+of|beginning\\s+of|start\\s+of|middle\\s+of|(?:first|second|third|last)\\s+week\\s+of|in|during|around|sometime\\s+in)(?:\\s+|\\s*-\\s*))${M}\\b(?:\\s+(\\d{4}))?`)) {
    ask(q.dates, `Which day in ${MONTH_NAMES[monthOf(m[1]) - 1]}? The request only says "${m[0].trim()}".`);
    take(m.index!, m.index! + m[0].length);
  }
  dates.sort((a, b) => a.start - b.start);

  const resolve = (w: When | undefined, anchor: string): string | null => {
    if (!w || w.unclear) return null;
    if (w.abs) return w.abs;
    if (w.m && w.d) return w.y ? isoOf(w.y, w.m, w.d) : nextOccurrence(w.m, w.d, anchor);
    if (w.d) {
      // "the 29th": the next 29th after the anchor date.
      const [ay, am, ad] = anchor.split("-").map(Number);
      return w.d >= ad ? isoOf(ay, am, w.d) : am === 12 ? isoOf(ay + 1, 1, w.d) : isoOf(ay, am + 1, w.d);
    }
    return null;
  };

  let departOn: string | null = null;
  let returnOn: string | null = null;
  const legDates: (string | null)[] = [];
  if (tripType === "Multi-city" && legs.length > 1) {
    // One date per flight, in the order written.
    let anchor = today;
    legs.forEach((_, i) => {
      const iso = resolve(dates[i], anchor);
      legDates.push(iso);
      if (iso) anchor = iso;
    });
    departOn = legDates[0];
    if (dates.length > legs.length) ask(q.dates, `There are ${dates.length} dates for ${legs.length} flights: check each flight's date.`);
    else if (dates.length < legs.length && dates.length) ask(q.dates, "Not every flight has a date: dates were matched to flights in the order written.");
  } else {
    // Which date is the departure and which the return.
    const RETURN_RE = /\bback\b|\breturning\b|\breturn(?:\s+(?:date|flight|leg))?\s*(?:on\b|by\b|:)|\bcoming\s+back\b|\binbound\b|\buntil\b|\btill\b|\bhome\s+(?:on|by)\b|\bret(?:urn)?\s*:/g;
    const DEPART_RE = /\bdepart(?:ing|ure)?\b|\bleav(?:e|ing)\b|\boutbound\b|\bgoing\b|\bfly(?:ing)?\s+out\b|\bout\s+on\b|\bdep\s*:/g;
    const lastIndex = (re: RegExp, s: string) => Math.max(-1, ...[...s.matchAll(re)].map((x) => x.index!));
    const roleOfDate = (w: When, i: number): "out" | "back" => {
      if (w.pair) return w.pair;
      const prev = dates[i - 1];
      if (prev && /^\s*(?:-|to|till|until|through|thru)\s*$/.test(low.slice(prev.end, w.start))) return "back";
      const before = low.slice(Math.max(prev ? prev.end : 0, w.start - 30), w.start).replace(/\b(?:there\s+)?and\s+back\b/g, "        ");
      return lastIndex(RETURN_RE, before) > lastIndex(DEPART_RE, before) ? "back" : "out";
    };
    const dateRoles = dates.map((w, i) => roleOfDate(w, i));
    const outs = dates.filter((_, i) => dateRoles[i] === "out");
    const backs = dates.filter((_, i) => dateRoles[i] === "back");
    let backDate: When | undefined = backs[0] ?? outs[1];
    if (dates.length > 2 || (outs.length > 1 && backs.length > 0)) ask(q.dates, "More than two dates were found: check the departure and return dates.");
    departOn = resolve(outs[0], today);
    if (oneWay && backDate && !backDate.unclear) {
      ask(q.dates, `The request says one-way but also gives a return date (${resolve(backDate, departOn ?? today)}). Is there a return?`);
      backDate = undefined;
    }
    returnOn = resolve(backDate, departOn ?? today);
    if (!returnOn && !backDate && departOn && stay && !oneWay) {
      returnOn = addDays(departOn, stay.days);
      if (!stay.exact) ask(q.dates, `Check the return date: "${stay.label}" was read as returning on ${returnOn}.`);
    }
    if (tripType !== "Multi-city") {
      if (returnOn || roundTrip) tripType = "Return";
      else if (oneWay) tripType = "One-way";
    }
    if (!returnOn && !backDate && roundTrip && !oneWay) ask(q.dates, "What is the return date?");
    else if (!returnOn && !backDate && departOn && !oneWay && !roundTrip && tripType !== "Multi-city") ask(q.dates, "Is it one-way? No return date was given.");
  }
  if (flexibleDays === null) {
    const approx = /\b(?:give\s+or\s+take|or\s+so)\b/.test(low) ||
      dates.some((w) => /(?:\baround|\babout|\bapprox\w*|\broughly|\bcirca|~|\bca\.)\s*(?:on\s+)?(?:the\s+)?$/.test(low.slice(Math.max(0, w.start - 15), w.start)));
    if (approx && dates.length) ask(q.dates, "Are the dates flexible? They were read as exact dates; say how many days either side.");
  }

  // Times belong to the outbound or the return flight, by what is written just before them.
  let departTime: string | null = null;
  let returnTime: string | null = null;
  for (const t of times) {
    const before = low.slice(Math.max(0, t.start - 40), t.start).replace(/\b(?:there\s+)?and\s+back\b/g, " ");
    const lastReturn = Math.max(-1, ...[...before.matchAll(/\b(?:back|return(?:ing)?|inbound|coming\s+back|ret)\b/g)].map((x) => x.index!));
    const lastOut = Math.max(-1, ...[...before.matchAll(/\b(?:depart(?:ing|ure)?|leav(?:e|ing)|outbound|going|out)\b/g)].map((x) => x.index!));
    const isReturn = lastReturn > lastOut && tripType === "Return";
    const current = isReturn ? returnTime : departTime;
    if (current && current !== t.value) ask(q.dates, `Which ${isReturn ? "return" : "departure"} time: ${current} or ${t.value}?`);
    else if (isReturn) returnTime = t.value;
    else departTime = t.value;
  }

  /* ── Passengers ── */
  const firstCount = (pattern: string) => {
    for (const m of all(pattern)) {
      const n = toNum(m.slice(1).find((g) => g !== undefined) ?? "");
      take(m.index!, m.index! + m[0].length);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  if (/\b(?:unaccompanied(?:\s+minor)?|umnr)\b/.test(low) || /\bUM\b/.test(orig)) {
    note("Unaccompanied minor");
    ask(q.pax, "An unaccompanied minor needs the airline's UM service and age rules: this search needs at least one adult.");
  }
  // Ages first: "aged 5 and 8", "a 10-month-old", "14 years old", "kids (5, 8)".
  const ages: number[] = [];
  for (const m of takeAll("\\b(\\d{1,2})\\s*-?\\s*(?:months?|mos?)\\s*-?\\s*old\\b|\\b(\\d{1,2})\\s*m\\/o\\b|\\b(?:aged?|age)\\s+(\\d{1,2})\\s*(?:months?|mos?)\\b|\\b(?:infant|baby)\\s*(?:of\\s+|aged?\\s+)?(\\d{1,2})\\s*(?:months?|mos?)\\b")) {
    ages.push(Number(m[1] ?? m[2] ?? m[3] ?? m[4]) < 24 ? 0 : 2);
  }
  for (const m of takeAll("\\b(?:aged?|ages)\\s+(\\d{1,2}(?:\\s*(?:,|and|&)\\s*\\d{1,2})*)\\b|\\b(\\d{1,2})\\s*-?\\s*(?:years?|yrs?|y)\\s*-?\\s*old\\b|\\b(\\d{1,2})\\s*(?:yo|y\\/o|yrs?)\\b|\\b(?:child(?:ren)?|kids?|sons?|daughters?|boys?|girls?|bab(?:y|ies)|infants?|toddlers?|teens?|teenagers?)\\s*\\(\\s*(\\d{1,2}(?:\\s*(?:,|and|&)\\s*\\d{1,2})*)\\s*\\)|\\b(?:children|kids)\\s+(\\d{1,2}(?:\\s*(?:,|and|&)\\s*\\d{1,2})+)\\b")) {
    for (const n of (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).split(/\s*(?:,|and|&)\s*/)) ages.push(Number(n));
  }
  const adultsSaid = firstCount(`\\b${NUM}\\s*(?:x\\s*)?(?:adults?|adt|grown[\\s-]?ups?)\\b|\\badults?\\s*[:x]?\\s*(\\d)\\b`);
  const childrenSaid = firstCount(`\\b${NUM}\\s*(?:x\\s*)?(?:child(?:ren)?|kids?|chd|chld|cnn)\\b|\\b(?:children|child|kids|chd)\\s*[:x]\\s*(\\d)\\b`);
  const infantsSaid = firstCount(`\\b${NUM}\\s*(?:x\\s*)?(?:lap\\s+)?(?:infants?|bab(?:y|ies)|inf)\\b|\\b(?:infants?|inf)\\s*[:x]\\s*(\\d)\\b`);
  const family = all(`\\b(?:family|group|party)\\s+of\\s+${NUM}\\b`)[0];
  const total = firstCount(`\\b${NUM}\\s*(?:pax|passengers?|people|persons?|travell?ers?|guests?|seats?|tickets?)\\b|\\b${NUM}\\s+of\\s+us\\b|\\bpax\\s*[:x]?\\s*(\\d)\\b`) ?? (family ? toNum(family[1]) : null);
  const couple = /\b(?:a\s+couple|couple|me\s+and\s+my\s+(?:wife|husband|partner|friend|spouse|fiancee?)|my\s+(?:wife|husband|partner|spouse)\s+and\s+(?:i|me)|honeymoon(?:ers)?|newlyweds|(?:the\s+)?two\s+of\s+us)\b/.test(low);
  const solo = /\b(?:solo|alone|just\s+me|only\s+me|by\s+myself|for\s+myself|single\s+travell?er|one\s+person)\b/.test(low) && !/\bunaccompanied|travell?ing\s+alone\s+(?:child|kid|minor)/.test(low);

  const childAges = ages.filter((a) => a >= 2 && a <= 11).length;
  const infantAges = ages.filter((a) => a < 2).length;
  const adultAges = ages.filter((a) => a >= 12);
  for (const a of adultAges) ask(q.pax, `A ${a}-year-old counts as an adult on flights. Check the number of adults.`);
  if (childrenSaid !== null && ages.length && childAges !== childrenSaid && childAges + infantAges + adultAges.length === childrenSaid) {
    ask(q.pax, "The children's ages don't all fit the child category (2–11): check children and infants.");
  }
  if (infantsSaid !== null && ages.some((a) => a >= 2) && !childrenSaid) ask(q.pax, "Infants are under 2: an older child travels as a child. Check the numbers.");
  let children: number | null = childrenSaid ?? (childAges || null);
  let infants: number | null = infantsSaid ?? (infantAges || null);
  if (children === null) {
    if (/\b(?:children|kids)\b/.test(work)) ask(q.pax, "How many children (2–11)?");
    else if (/\b(?:child|kid)\b/.test(work)) children = 1;
  }
  if (infants === null) {
    if (/\b(?:infants|babies)\b/.test(work)) ask(q.pax, "How many infants (under 2)?");
    else if (/\b(?:infant|baby|newborn)\b/.test(work)) infants = 1;
  }
  if (/\btoddlers?\b/.test(work)) ask(q.pax, "A toddler is an infant under 2 and a child from 2: how old?");
  if (/\b(?:teen|teens|teenager|teenagers)\b/.test(work) && !adultAges.length) ask(q.pax, "A teenager (12+) counts as an adult on flights. Check the number of adults.");
  let adults = adultsSaid;
  if (adults === null) {
    if (total !== null) {
      if (family && childrenSaid === null && infantsSaid === null && !ages.length && children === null && infants === null) {
        ask(q.pax, `How many of the ${total} travellers are adults, children (2–11) and infants (under 2)?`);
      } else if (total - (children ?? 0) - (infants ?? 0) >= 1) adults = total - (children ?? 0) - (infants ?? 0);
    } else if (couple) adults = 2;
    else if (solo) adults = 1;
  } else if (total !== null && total !== adults + (children ?? 0) + (infants ?? 0)) {
    ask(q.pax, `The request mentions ${total} travellers but ${adults} adults, ${children ?? 0} children and ${infants ?? 0} infants: check the numbers.`);
  }
  if (infants !== null && adults !== null && infants > adults) ask(q.pax, "Each infant (on a lap) needs its own adult: check the numbers, or book an older infant a seat.");
  if (/\binfants?\s+(?:with\s+)?(?:(?:its|their|an?)\s+)?(?:own\s+)?seats?\b|\b(?:own|separate)\s+seat\s+for\s+(?:the\s+)?(?:infant|baby)\b/.test(low)) note("Infant with own seat");
  if (/\bbassinet\b/.test(low)) note("Bassinet requested");
  if (/\bstudents?\b/.test(low)) note("Student traveller: student fares need eligibility checks");
  if (/\b(?:seniors?|senior\s+citizens?|elderly|pensioners?)\b/.test(low)) note("Senior traveller");
  if (/\bpregnan\w*\b/.test(low)) {
    note("Pregnant traveller");
    ask(q.pax, "Airlines restrict travel later in pregnancy: check the airline's rules for the travel dates.");
  }
  if (/\b(?:wheelchair|wchr|wchs|wchc|reduced\s+mobility|mobility\s+assistance|special\s+assistance)\b/.test(low)) note("Wheelchair / mobility assistance");
  if (/\b(?:pets?|dogs?|cats?)\b/.test(work)) note("Travelling with a pet: confirm the airline's rules");
  const meal = /\b(vegetarian|vegan|halal|kosher|gluten[\s-]?free|diabetic|hindu|child|baby|low[\s-]?salt)\s+meals?\b/.exec(low);
  if (meal) note(`Special meal: ${meal[1]}`);
  const seat = /\b(window|aisle|exit[\s-]row|extra[\s-]legroom|front[\s-]row|sit\s+together|seats?\s+together)\b/.exec(low);
  if (seat) note(`Seat request: ${seat[1].replace(/-/g, " ")}`);
  if (/\blounge\b/.test(low)) note("Lounge access requested");

  /* ── Cabin ── */
  const cabins = new Set<Cabin>();
  const premium = /\bprem(?:ium)?(?:[\s-]*(?:eco(?:nomy)?|class|cabin))?\b|\bw[\s-]class\b/.exec(work);
  let scan = (premium ? work.replace(premium[0], " ".repeat(premium[0].length)) : work).replace(/\b(?:on|for)\s+business\b/g, (x) => " ".repeat(x.length));
  if (premium) cabins.add("Premium economy");
  if (/\b(?:economy\s+(?:plus|comfort)|comfort\s+plus|extra\s+comfort)\b/.test(scan)) {
    cabins.add("Economy");
    note("Extra-legroom economy (Economy Plus / Comfort)");
    scan = scan.replace(/\beconomy\s+(?:plus|comfort)\b/g, (x) => " ".repeat(x.length));
  }
  if (/\b(?:business|biz|buisness|busines)[\s-]*class\b|\bj[\s-]class\b|\bclub\s+(?:class|world|europe|suite)\b|\bupper\s+class\b|\bpolaris\b|\bqsuites?\b|\bbusiness\b(?!\s+(?:trip|travel|meeting|purposes?|visit|conference|reasons?|people|partners?|man|men|woman|women|visa|days?))/.test(scan)) cabins.add("Business");
  if (/\bfirst[\s-]*class\b|\bf[\s-]class\b|\bla\s+premiere\b|\b(?:in|fly|flying|business|economy|premium)\s*(?:or|and|\/|,)?\s*first\b(?!\s+(?:week|day|half|time|of|thing|flight|leg|stop))/.test(scan)) cabins.add("First");
  if (/\b(?:economy|eco[\s-]class|coach|y[\s-]class|main\s+cabin|standard\s+class|tourist\s+class)\b/.test(scan)) cabins.add("Economy");
  let cabin: Cabin | null = null;
  if (cabins.size === 1) cabin = [...cabins][0];
  else if (cabins.size > 1) {
    ask(q.other, /\b(?:outbound|return|back|there|going)\b/.test(low)
      ? `Mixed cabins (${[...cabins].join(", ")}) can't be saved in one search: which cabin, or save each direction separately?`
      : `Which cabin class: ${[...cabins].join(" or ")}?`);
  }

  /* ── A place typed with a spelling mistake, or not in the list ── */
  const STOP = new Set(["fly", "go", "travel", "book", "be", "the", "a", "an", "return", "come", "visit", "see", "get", "leave", "depart", "stay", "back", "and", "or", "us", "me", "them", "him", "her", "it", "here", "there", "home", "work", "end", "start", "about", "around", "attend", "check", "make", "have", "spend", "take", "my", "our", "your", "their", "his", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "one", "all", "any", "family", "friends", "please", "budget", "early", "late", "mid", "arrive", "celebrate", "meet", "reach", "catch", "find", "know", "confirm", "change", "search", "quote", "compare", "connect", "transfer", "holiday", "vacation", "honeymoon", "business", "study", "join", "relocate", "move", "those", "these", "this", "that", "where", "which", "somewhere", "economy", "first", "premium", "direct", "seat", "book", "price", "save", "avoid", "keep", "sit"]);
  const missingFrom = !first?.from?.code && !first?.from?.question;
  const missingTo = !first?.to?.code && !first?.to?.question;
  for (const [slot, missing] of [["from", missingFrom], ["to", missingTo]] as const) {
    if (!missing) continue;
    for (const m of all(`\\b${slot}\\s+([a-z][a-z']{3,})(?:\\s+([a-z][a-z']+))?`)) {
      const one = m[1];
      if (STOP.has(one) || one in MONTH_WORDS || WEEKDAYS.includes(one)) continue;
      const two = m[2] ? `${one} ${m[2]}` : "";
      let best: [string, string, number] | null = null;
      for (const [name, code] of Object.entries(PLACES)) {
        const typed = name.includes(" ") ? two : one;
        if (!typed) continue;
        const dist = levenshtein(typed, name);
        const allowed = typed.length >= 8 ? 2 : typed.length >= 5 ? 1 : 0;
        if (dist <= allowed && (!best || dist < best[2])) best = [name, code, dist];
      }
      if (best) ask(q.route, `Did you mean ${title(best[0])} (${best[1]})? "${best[0].includes(" ") ? two : one}" isn't in the airport list.`);
      else ask(q.route, `"${title(one)}" isn't in the airport list: enter its 3-letter code.`);
      break;
    }
  }

  return {
    trip_type: tripType,
    origin: codeOf(first?.from ?? null),
    destination: first ? codeOf(first.to) : null,
    depart_on: departOn,
    return_on: tripType === "Multi-city" ? null : returnOn,
    legs: tripType === "Multi-city" ? legs.slice(1).map((l, i) => ({ origin: codeOf(l.from), destination: codeOf(l.to), depart_on: legDates[i + 1] ?? null })) : [],
    flexible_days: flexibleDays,
    adults,
    children,
    infants,
    cabin: cabin && (CABINS as readonly string[]).includes(cabin) ? cabin : null,
    stops,
    via: via.slice(0, 3),
    max_connection_hours: maxConnectionHours,
    depart_time: departTime,
    return_time: returnTime,
    preferred_airlines: airlines.slice(0, 6),
    baggage,
    checked_bags: checkedBags,
    baggage_note: baggageNote,
    fare_rules: fareRules,
    budget_amount: budgetAmount,
    budget_currency: budgetCurrency,
    notes: notes.slice(0, 8),
    questions: [...q.route, ...q.dates, ...q.pax, ...q.other],
  };
}
