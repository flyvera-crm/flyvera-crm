// Local flight-request reader: turns an agent's plain-words trip request into search details, entirely
// on our own server (no AI service, no network, no API key, no cost). Pure and unit-tested.
//
// It recognises patterns; it does not "understand" text. So whenever something is missing, unclear or
// could be read two ways, it leaves the field empty and adds a question for the agent instead of guessing.
// Its answer has the same shape the AI used to return, so draftFromReading (src/lib/flight-request.ts)
// re-checks every value before the agent sees it. It has no fields for fares, availability, PNRs or
// ticket numbers, and can't produce them.
import { CABINS, type Cabin } from "@/lib/flight-request";
import {
  AIRLINE_CODES,
  AIRLINES,
  AMBIGUOUS_AIRLINE_CODES,
  AMBIGUOUS_PLACES,
  CODE_WORDS,
  COUNTRIES,
  CURRENCY_CODES,
  NOT_PLACES,
  PLACES,
} from "@/lib/travel-codes";

/** Stored as the "model" of each reading in the log (ai_actions), so old AI readings stay distinguishable. */
export const READER_VERSION = "local-parser-v1";

export type FlightRequestReading = {
  origin: string | null;
  destination: string | null;
  depart_on: string | null;
  return_on: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  cabin: Cabin | null;
  preferred_airlines: string[];
  budget_amount: number | null;
  budget_currency: string | null;
  questions: string[];
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUM = "(\\d{1,2}|an?|one|two|three|four|five|six|seven|eight|nine|ten)";
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s] ?? NaN);

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const M = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthOf = (s: string) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(s.slice(0, 3)) + 1;
const ORD = "(?:st|nd|rd|th)?";
const Y = "(?:(?:,\\s*|\\s+|-)(\\d{4}|'\\d{2}))?";
const SEP = "\\s*(?:-|to|till|until|through|thru)\\s*";
const PAX_WORDS = "adults?|adt|kids?|child(?:ren)?|chd|infants?|bab(?:y|ies)|inf|pax|people|persons?|passengers?|travell?ers?|guests?|seats?|tickets?|nights?|days?|weeks?|years?|yrs?|months?";
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
const title = (s: string) => (s.length <= 3 ? s.toUpperCase() : s.replace(/\b[a-z]/g, (c) => c.toUpperCase()));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s-]+");

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

/** The request in two forms of equal length: `orig` keeps capitals (for codes), `low` is lower-case. */
function prepare(input: string) {
  const orig = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*(?:→|->|=>|⇒|➔|➝)\s*/g, " to ")
    .replace(/[–—]/g, "-")
    .replace(/[’‘]/g, "'")
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

  const q = { route: [] as string[], dates: [] as string[], pax: [] as string[], other: [] as string[] };
  const ask = (list: string[], question: string) => list.includes(question) || list.push(question);

  /* ── Trip type ── */
  const oneWay = /\bone[\s-]?way\b|\bsingle\s+(?:trip|journey|ticket|flight)\b|\bow\b/.test(low);
  let roundTrip = /\breturn\b|\bround[\s-]?trip\b|\brtn\b|\bthere\s+and\s+back\b|\band\s+back\b|\bback\s+(?:on|by)\b|\bcoming\s+back\b|\bboth\s+ways\b/.test(low);

  /* ── Preferred airlines ── */
  const airlineHits: (Span & { code: string })[] = [];
  const preferBefore = (start: number) => /(?:\bprefer(?:s|red|ably)?|\bwith|\bon|\bfly(?:ing)?|\bairlines?:?|\bcarriers?:?|\bby)\s*$/.test(low.slice(Math.max(0, start - 20), start));
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
      ask(q.other, `Airlines to avoid (${h.code}) can't be saved as a preference: add them to the notes.`);
    } else if (!airlines.includes(h.code)) airlines.push(h.code);
  }

  /* ── Places ── */
  type Place = Span & { code: string | null; label: string; question?: string };
  const places: Place[] = [];
  const names = [...Object.keys(PLACES), ...Object.keys(AMBIGUOUS_PLACES), ...COUNTRIES].sort((a, b) => b.length - a.length);
  for (const m of all(`\\b(?:${names.map(escapeRe).join("|")})\\b`)) {
    const start = m.index!;
    const end = start + m[0].length;
    const name = m[0].replace(/[\s-]+/g, " ");
    if (name in PLACES) places.push({ start, end, code: PLACES[name], label: `${title(name)} (${PLACES[name]})` });
    else if (name in AMBIGUOUS_PLACES) places.push({ start, end, code: null, label: title(name), question: AMBIGUOUS_PLACES[name] });
    else places.push({ start, end, code: null, label: title(name), question: `Which airport or city in ${title(name)}?` });
    take(start, end);
  }
  const knownCodes = new Set([...Object.values(PLACES), ...EXTRA_AIRPORT_CODES]);
  for (const m of orig.matchAll(/\b([A-Za-z]{3})\b/g)) {
    const start = m.index!;
    const end = start + 3;
    const token = m[1];
    const code = token.toUpperCase();
    if (!free(start, end)) continue;
    if (token === code) {
      if (NOT_PLACES.has(code)) continue;
    } else {
      // Typed in lower case: only a known code, not an English word, right next to "to" / "from" / "-".
      const adjacent = /(?:\bto|\bfrom|\bex|-|\/)\s*$/.test(low.slice(Math.max(0, start - 6), start)) || /^\s*(?:to\b|-|\/)/.test(low.slice(end, end + 4));
      if (!knownCodes.has(code) || CODE_WORDS.has(token.toLowerCase()) || !adjacent) continue;
    }
    places.push({ start, end, code, label: code });
    take(start, end);
  }
  places.sort((a, b) => a.start - b.start);

  type Role = "from" | "to" | "via" | "back" | "none";
  const roleOf = (p: Place, prev: Place | undefined): Role => {
    const before = low.slice(Math.max(prev ? prev.end : 0, p.start - 30), p.start).replace(/\bthe\s*$/, "");
    if (/\b(?:via|through|thru|stop(?:ping|over)?(?:\s+(?:in|at))?|connecting\s+(?:in|at|through)|transit(?:ing)?(?:\s+(?:in|at|through))?|layover\s+(?:in|at))\s*$/.test(before)) return "via";
    if (/\bback\s+to\s*$/.test(before)) return "back";
    if (/(?:\bfrom|\bex|\bleaving|\bdeparting|\bout\s+of)\s*$/.test(before)) return "from";
    if (/(?:\bto|\binto|\btowards?|\bfor)\s*$/.test(before)) return "to";
    if (prev && /^\s*[-/]\s*$/.test(low.slice(prev.end, p.start))) return "to";
    return "none";
  };
  const roles = places.map((p, i) => ({ ...p, role: roleOf(p, places[i - 1]) }));
  for (const p of roles.filter((r) => r.role === "via")) ask(q.route, `The stop in ${p.label} can't be saved with the search: add it to the notes.`);
  const legs = roles.filter((r) => r.role !== "via" && r.role !== "back");
  let origin = legs.find((r) => r.role === "from");
  let dest = legs.find((r) => r.role === "to" && r !== origin && (r.code === null || r.code !== origin?.code));
  if (!origin && dest) origin = legs.slice(0, legs.indexOf(dest)).reverse().find((r) => r.role === "none");
  if (origin && !dest) dest = legs.find((r) => r.start > origin!.start && r.role === "none" && r.code !== origin!.code);
  if (!origin && !dest) {
    if (legs.length >= 2) {
      [origin, dest] = legs;
      ask(q.route, `Check the direction: it was read as ${origin.label} → ${dest.label}.`);
    } else if (legs.length === 1) ask(q.route, `Is ${legs[0].label} the departure or the arrival?`);
  }
  for (const r of roles.filter((x) => x.role === "back")) {
    roundTrip = true;
    if (origin && r.code !== origin.code) ask(q.route, `The trip returns to ${r.label}, not ${origin.label}: save each direction as a separate search.`);
  }
  for (const p of legs) if (p.question && (p === origin || p === dest || legs.length === 1)) ask(q.route, p.question);
  const others = legs.filter((r) => r !== origin && r !== dest && (r.code === null || (r.code !== origin?.code && r.code !== dest?.code)));
  if (others.length) ask(q.route, `Only one route can be saved; the request also mentions ${others.map((r) => r.label).join(", ")}. Save other legs as separate searches.`);

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
    if (s === "$" || /^(?:dollars?|bucks)$/.test(s)) return "USD";
    if (s === "£" || /^(?:pounds?|quid)$/.test(s)) return "GBP";
    if (s === "€" || /^euros?$/.test(s)) return "EUR";
    if (s === "₹") return "INR";
    if (/^(?:dirhams?|dhs?)$/.test(s)) return "AED";
    return null; // rupees, riyals: more than one currency uses the name
  };
  const codes = CURRENCY_CODES.map((c) => c.toLowerCase()).join("|");
  const WORDS = "dollars?|bucks|dirhams?|dhs?|euros?|pounds?|quid|rupees?|rs|riyals?|rials?";
  const addMoney = (m: RegExpMatchArray, num: string, suffix: string | undefined, word: string) => {
    const start = m.index!;
    const end = start + m[0].length;
    if (!free(start, end)) return;
    money.push({ start, end, amount: amountOf(num, suffix), currency: currencyOf(word), word });
    take(start, end);
  };
  for (const m of all(`(?:([$£€₹])|\\b(${codes}|dhs?|rs)\\.?)\\s*${AMT}`)) addMoney(m, m[3], m[4], m[1] ?? m[2]);
  for (const m of all(`\\b${AMT}\\s*(${codes}|${WORDS})\\b`)) addMoney(m, m[1], m[2], m[3]);
  if (!money.length) {
    const lead = "\\b(?:budget|max(?:imum)?\\s+(?:budget|spend)|spend|up\\s+to|no\\s+more\\s+than|not\\s+more\\s+than|less\\s+than)(?:\\s+(?:is|of|around|about|approx\\w*|max(?:imum)?|under|below|~))*\\s*:?\\s*";
    for (const m of all(`${lead}${AMT}${NOT_PAX}(?!\\s*${ORD.slice(0, -1)}\\b)(?!\\s*(?:-|/|of)?\\s*${M})`)) {
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

  /* ── Dates ── */
  type When = Span & { y?: number; m?: number; d?: number; abs?: string; unclear?: true; pair?: "out" | "back" };
  const dates: When[] = [];
  const addDate = (m: RegExpMatchArray, w: Omit<When, "start" | "end">, start = m.index!, end = m.index! + m[0].length) => {
    if (!free(start, end)) return;
    dates.push({ start, end, ...w });
    take(start, end);
  };
  // Two dates in one phrase: "15-29 Jan", "Jan 15 to 29".
  for (const m of all(`\\b(\\d{1,2})${ORD}${SEP}(\\d{1,2})${ORD}(?:\\s+|-)(?:of\\s+)?${M}\\b${Y}`)) {
    const mo = monthOf(m[3]);
    const y = yearOf(m[4]);
    if (!free(m.index!, m.index! + m[0].length)) continue;
    take(m.index!, m.index! + m[0].length);
    dates.push({ start: m.index!, end: m.index! + 1, y, m: mo, d: Number(m[1]), pair: "out" }, { start: m.index! + 1, end: m.index! + m[0].length, y, m: mo, d: Number(m[2]), pair: "back" });
  }
  for (const m of all(`\\b${M}\\.?\\s+(\\d{1,2})${ORD}${SEP}(\\d{1,2})${ORD}\\b${NOT_PAX}${Y}`)) {
    const mo = monthOf(m[1]);
    const y = yearOf(m[4]);
    if (!free(m.index!, m.index! + m[0].length)) continue;
    take(m.index!, m.index! + m[0].length);
    dates.push({ start: m.index!, end: m.index! + 1, y, m: mo, d: Number(m[2]), pair: "out" }, { start: m.index! + 1, end: m.index! + m[0].length, y, m: mo, d: Number(m[3]), pair: "back" });
  }
  for (const m of all("\\b(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})\\b")) addDate(m, { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  for (const m of all(`\\b(\\d{1,2})([/.-])(\\d{1,2})(?:\\2(\\d{4}|\\d{2}))?\\b${NOT_PAX}(?![.,]\\d)`)) {
    if (m[2] !== "/" && !m[4]) continue; // "2-3" or "9.5" alone are not dates
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = yearOf(m[4]);
    if (a > 12 && b >= 1 && b <= 12) addDate(m, { y, m: b, d: a });
    else if (b > 12 && a >= 1 && a <= 12) addDate(m, { y, m: a, d: b });
    else if (a === b && a >= 1) addDate(m, { y, m: a, d: a });
    else if (a >= 1 && b >= 1 && a <= 12 && b <= 12) {
      addDate(m, { unclear: true });
      ask(q.dates, `Is ${m[0]} ${a} ${MONTH_NAMES[b - 1]} (day/month) or ${MONTH_NAMES[a - 1]} ${b} (month/day)?`);
    }
  }
  for (const m of all(`\\b(\\d{1,2})${ORD}(?:\\s+|-)?(?:of\\s+)?${M}\\b\\.?${Y}`)) addDate(m, { y: yearOf(m[3]), m: monthOf(m[2]), d: Number(m[1]) });
  for (const m of all(`\\b${M}\\.?(?:\\s+|-)(?:the\\s+)?(\\d{1,2})${ORD}\\b${NOT_PAX}${Y}`)) addDate(m, { y: yearOf(m[3]), m: monthOf(m[1]), d: Number(m[2]) });
  for (const m of all(`\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\b(?!\\s*(?:class|time|week|leg|flight|floor)\\b)`)) addDate(m, { d: Number(m[1]) });
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
  for (const m of all(`\\bfor\\s+${NUM}\\s+(nights?|days?|weeks?|fortnights?)\\b|\\b(\\d{1,2})[\\s-](nights?|days?|weeks?)\\s+(?:trip|stay|holiday|vacation|break)\\b`)) {
    const n = toNum(m[1] ?? m[3]);
    const unit = m[2] ?? m[4];
    if (!n || stay) continue;
    stay = { days: n * (unit.startsWith("fortnight") ? 14 : unit.startsWith("week") ? 7 : 1), label: m[0].replace(/^for\s+/, ""), exact: !unit.startsWith("day") };
    take(m.index!, m.index! + m[0].length);
  }
  for (const m of all("\\b(?:next\\s+(?:week|month|weekend)|this\\s+(?:week|weekend|month)|end\\s+of\\s+(?:the\\s+|this\\s+|next\\s+)?month)\\b")) {
    ask(q.dates, `Which date? The request only says "${m[0]}".`);
    take(m.index!, m.index! + m[0].length);
  }
  for (const m of all(`\\b(?:(?:early|mid|late|end\\s+of|beginning\\s+of|start\\s+of|middle\\s+of|(?:first|second|third|last)\\s+week\\s+of|in|during|around|sometime\\s+in)(?:\\s+|\\s*-\\s*))${M}\\b(?:\\s+(\\d{4}))?`)) {
    ask(q.dates, `Which day in ${MONTH_NAMES[monthOf(m[1]) - 1]}? The request only says "${m[0].trim()}".`);
    take(m.index!, m.index! + m[0].length);
  }
  dates.sort((a, b) => a.start - b.start);

  // Which date is the departure and which the return.
  const RETURN_RE = /\bback\b|\breturning\b|\breturn(?:\s+(?:date|flight))?\s*(?:on\b|by\b|:)|\bcoming\s+back\b|\binbound\b|\buntil\b|\btill\b|\bhome\s+(?:on|by)\b/g;
  const DEPART_RE = /\bdepart(?:ing|ure)?\b|\bleav(?:e|ing)\b|\boutbound\b|\bgoing\b|\bfly(?:ing)?\s+out\b|\bout\s+on\b/g;
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
  const outDate = outs[0];
  let backDate: When | undefined = backs[0] ?? outs[1];
  if (dates.length > 2 || (outs.length > 1 && backs.length > 0)) ask(q.dates, "More than two dates were found: check the departure and return dates.");
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
  const departOn = resolve(outDate, today);
  if (oneWay && backDate && !backDate.unclear) {
    ask(q.dates, `The request says one-way but also gives a return date (${resolve(backDate, departOn ?? today)}). Is there a return?`);
    backDate = undefined;
  }
  let returnOn = resolve(backDate, departOn ?? today);
  if (!returnOn && !backDate && departOn && stay && !oneWay) {
    returnOn = addDays(departOn, stay.days);
    if (!stay.exact) ask(q.dates, `Check the return date: "${stay.label}" was read as returning on ${returnOn}.`);
  }
  if (!returnOn && !backDate && roundTrip && !oneWay) ask(q.dates, "What is the return date?");
  else if (!returnOn && !backDate && departOn && !oneWay && !roundTrip) ask(q.dates, "Is it one-way? No return date was given.");
  const approx =
    /\b(?:flexible|flex|give\s+or\s+take|or\s+so)\b|\+\/?-\s*\d|±\s*\d/.test(low) ||
    dates.some((w) => /(?:\baround|\babout|\bapprox\w*|\broughly|\bcirca|~)\s*(?:on\s+)?(?:the\s+)?$/.test(low.slice(Math.max(0, w.start - 15), w.start)));
  if (approx && dates.length) ask(q.dates, "Are the dates flexible? They were read as exact dates.");

  /* ── Passengers ── */
  const firstCount = (pattern: string) => {
    for (const m of all(pattern)) {
      const n = toNum(m.slice(1).find((g) => g !== undefined) ?? "");
      take(m.index!, m.index! + m[0].length);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  // Ages first: "aged 5 and 8", "a 10-month-old", "14 years old".
  const ages: number[] = [];
  for (const m of all("\\b(\\d{1,2})\\s*-?\\s*months?\\s*-?\\s*old\\b|\\b(?:aged?|age)\\s+(\\d{1,2})\\s*months?\\b")) {
    ages.push(0);
    take(m.index!, m.index! + m[0].length);
  }
  for (const m of all("\\b(?:aged?|age)\\s+(\\d{1,2}(?:\\s*(?:,|and|&)\\s*\\d{1,2})*)\\b|\\b(\\d{1,2})\\s*-?\\s*(?:years?|yrs?|y)\\s*-?\\s*old\\b|\\b(\\d{1,2})\\s*yo\\b")) {
    for (const n of (m[1] ?? m[2] ?? m[3]).split(/\s*(?:,|and|&)\s*/)) ages.push(Number(n));
    take(m.index!, m.index! + m[0].length);
  }
  const adultsSaid = firstCount(`\\b${NUM}\\s*(?:x\\s*)?(?:adults?|adt|grown[\\s-]?ups?)\\b`);
  const childrenSaid = firstCount(`\\b${NUM}\\s*(?:x\\s*)?(?:child(?:ren)?|kids?|chd|chld)\\b`);
  const infantsSaid = firstCount(`\\b${NUM}\\s*(?:x\\s*)?(?:lap\\s+)?(?:infants?|bab(?:y|ies)|inf)\\b`);
  const family = all(`\\b(?:family|group|party)\\s+of\\s+${NUM}\\b`)[0];
  const total = firstCount(`\\b${NUM}\\s*(?:pax|passengers?|people|persons?|travell?ers?|guests?|seats?|tickets?)\\b|\\b${NUM}\\s+of\\s+us\\b`) ?? (family ? toNum(family[1]) : null);
  const couple = /\b(?:a\s+couple|couple|me\s+and\s+my\s+(?:wife|husband|partner|friend|spouse)|my\s+(?:wife|husband|partner|spouse)\s+and\s+(?:i|me)|honeymoon|(?:the\s+)?two\s+of\s+us)\b/.test(low);
  const solo = /\b(?:solo|alone|just\s+me|only\s+me|by\s+myself|for\s+myself|single\s+travell?er|one\s+person)\b/.test(low);

  const childAges = ages.filter((a) => a >= 2 && a <= 11).length;
  const infantAges = ages.filter((a) => a < 2).length;
  for (const a of ages.filter((x) => x >= 12)) ask(q.pax, `A ${a}-year-old counts as an adult on flights. Check the number of adults.`);
  let children: number | null = childrenSaid ?? (childAges || null);
  let infants: number | null = infantsSaid ?? (infantAges || null);
  if (children === null) {
    if (/\b(?:children|kids)\b/.test(work)) ask(q.pax, "How many children (2–11)?");
    else if (/\b(?:child|kid)\b/.test(work)) children = 1;
  }
  if (infants === null) {
    if (/\b(?:infants|babies)\b/.test(work)) ask(q.pax, "How many infants (under 2)?");
    else if (/\b(?:infant|baby)\b/.test(work)) infants = 1;
  }
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

  /* ── Cabin ── */
  const cabins = new Set<Cabin>();
  const premium = /\bprem(?:ium)?(?:[\s-]*(?:eco(?:nomy)?|class|cabin))?\b|\bw[\s-]class\b/.exec(work);
  const scan = (premium ? work.replace(premium[0], " ".repeat(premium[0].length)) : work).replace(/\b(?:on|for)\s+business\b/g, (x) => " ".repeat(x.length));
  if (premium) cabins.add("Premium economy");
  if (/\b(?:business|biz|buisness|busines)[\s-]*class\b|\bj[\s-]class\b|\bclub\s+(?:class|world|europe)\b|\bbusiness\b(?!\s+(?:trip|travel|meeting|purposes?|visit|conference|reasons?|people|partners?|man|men|woman|women))/.test(scan)) cabins.add("Business");
  if (/\bfirst[\s-]*class\b|\bf[\s-]class\b|\b(?:in|fly|flying|business|economy|premium)\s*(?:or|and|\/|,)?\s*first\b(?!\s+(?:week|day|half|time|of|thing))/.test(scan)) cabins.add("First");
  if (/\b(?:economy|eco[\s-]class|coach|y[\s-]class)\b/.test(scan)) cabins.add("Economy");
  let cabin: Cabin | null = null;
  if (cabins.size === 1) cabin = [...cabins][0];
  else if (cabins.size > 1) ask(q.other, `Which cabin class: ${[...cabins].join(" or ")}?`);

  /* ── A place typed with a spelling mistake, or not in the list ── */
  const STOP = new Set(["fly", "go", "travel", "book", "be", "the", "a", "an", "return", "come", "visit", "see", "get", "leave", "depart", "stay", "back", "and", "or", "us", "me", "them", "him", "her", "it", "here", "there", "home", "work", "end", "start", "about", "around", "attend", "check", "make", "have", "spend", "take", "my", "our", "your", "their", "his", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "one", "all", "any", "family", "friends", "please", "budget", "early", "late", "mid", "arrive", "celebrate", "meet", "reach", "catch", "find", "know", "confirm", "change", "search", "quote", "compare", "connect", "transfer", "holiday", "vacation", "honeymoon", "business", "study", "join", "relocate", "move", "those", "these", "this", "that", "where", "which", "somewhere"]);
  for (const [slot, word] of [["from", !origin], ["to", !dest]] as const) {
    if (!word) continue;
    for (const m of all(`\\b${slot}\\s+([a-z][a-z']{3,})(?:\\s+([a-z][a-z']+))?`)) {
      const one = m[1];
      if (STOP.has(one)) continue;
      const two = m[2] ? `${one} ${m[2]}` : "";
      const candidates = Object.entries(PLACES);
      let best: [string, string, number] | null = null;
      for (const [name, code] of candidates) {
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
    origin: origin?.code ?? null,
    destination: dest?.code ?? null,
    depart_on: departOn,
    return_on: returnOn,
    adults,
    children,
    infants,
    cabin: cabin && (CABINS as readonly string[]).includes(cabin) ? cabin : null,
    preferred_airlines: airlines.slice(0, 6),
    budget_amount: budgetAmount,
    budget_currency: budgetCurrency,
    questions: [...q.route, ...q.dates, ...q.pax, ...q.other],
  };
}

/** Airport codes (besides the city codes in PLACES) accepted when typed in lower case next to "to" / "from". */
const EXTRA_AIRPORT_CODES = [
  "LHR", "LGW", "STN", "LTN", "LCY", "JFK", "LGA", "ORD", "MDW", "IAD", "DCA", "DWC", "CDG", "ORY", "FCO", "MXP", "LIN", "NRT",
  "HND", "KIX", "ICN", "GMP", "PEK", "PKX", "PVG", "DMK", "CGK", "SAW", "SHJ", "YYZ", "YUL", "GRU", "GIG", "EZE", "SVO", "DME",
  "BHX", "BHM", "PDX", "PWM", "HYD", "HDD", "SJC", "SJO", "GOX", "TXL", "NCE", "SPU",
];
