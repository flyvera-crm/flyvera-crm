// Phase 3: reading flight requests with the local reader (no AI service, no network, no cost).
// The pure logic is tested directly; the wiring of the server action and panel is checked in the source.
// Database side (log, daily limit, personal-data backstop): supabase/tests section 26.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DAILY_LIMIT,
  draftFromReading,
  emptyDraft,
  MAX_REQUEST_CHARS,
  personalDataProblem,
  requestTextProblem,
  searchRow,
  validateDraft,
} from "@/lib/flight-request";
import { parseFlightRequest, READER_VERSION } from "@/lib/flight-request-parser";
import { AIRLINES, PLACES } from "@/lib/travel-codes";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-11-27"; // a Friday
const parse = (text) => parseFlightRequest(text, TODAY);
const hasQuestion = (r, re) => r.questions.some((q) => re.test(q));

// Same samples as the database tests (section 26), so the app and the database agree.
const REFUSED = [
  "Book for jane.doe@example.com DXB-LHR",
  "Call +44 7700 900123 about Dubai to London",
  "call 0501234567 re trip",
  "passport AB1234567, Dubai to London",
  "ID 784198712345678 travelling to Paris",
];
const ALLOWED = [
  "2 adults DXB to LHR on 2027-01-15, back 2027-01-29, business, EK or QR",
  "Dubai to London 15/01/2027 return 29.01.27, budget USD 9,000",
  "1 adult, 1 infant, prefer EK001 if possible, budget 12500 AED",
];

describe("no personal data in the request (it is kept in the log)", () => {
  it("refuses e-mail addresses, phone / ID numbers and passport-style numbers", () => {
    for (const t of REFUSED) assert.ok(personalDataProblem(t), t);
  });

  it("allows ordinary trip details", () => {
    for (const t of ALLOWED) assert.equal(personalDataProblem(t), null, t);
  });

  it("refuses the linked customer's or lead's name (accents and case ignored)", () => {
    assert.equal(personalDataProblem("Amélie Hartley wants DXB to LHR", ["Amelie Hartley"]), "Remove the customer's name: link the lead or customer below instead.");
    assert.ok(personalDataProblem("trip for HARTLEY family to Paris", ["Amelie Hartley"]));
    assert.equal(personalDataProblem("2 adults Dubai to London", ["Amelie Hartley"]), null);
    assert.equal(personalDataProblem("2 adults Dubai to London", ["Al Li"]), null, "parts under 3 letters are ignored");
  });

  it("checks length and emptiness first", () => {
    assert.equal(requestTextProblem("   "), "Describe the trip first.");
    assert.equal(requestTextProblem(42), "Describe the trip first.");
    assert.equal(requestTextProblem("x".repeat(MAX_REQUEST_CHARS + 1)), `Keep the request under ${MAX_REQUEST_CHARS} characters.`);
    assert.equal(requestTextProblem("DXB to LHR next month"), null);
  });
});

describe("no AI service: everything is read on our own server", () => {
  it("nothing in the project calls Anthropic, OpenAI or another AI service, or needs a key", () => {
    assert.ok(!("@anthropic-ai/sdk" in (JSON.parse(read("package.json")).dependencies ?? {})), "Anthropic SDK removed");
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(ts|tsx)$/.test(n) && files.push(join(d, n))));
    walk(fileURLToPath(new URL("../../src", import.meta.url)));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/@anthropic-ai|ANTHROPIC_API_KEY|api\.anthropic\.com|openai|OPENAI_API_KEY|generativelanguage|api\.cohere|api\.mistral/i.test(src), `${f} must not use an AI service`);
    }
  });

  it("the reader makes no network calls and uses no environment variables", () => {
    for (const f of ["src/lib/flight-request-parser.ts", "src/lib/travel-codes.ts", "src/lib/flight-request.ts"]) {
      const src = read(f);
      assert.ok(!/\bfetch\(|https?:\/\/|process\.env|XMLHttpRequest|WebSocket/.test(src), `${f} stays local`);
    }
  });

  it("the server action logs each reading, then reads it locally", () => {
    const a = read("src/lib/actions/flight-requests.ts");
    const fn = a.slice(a.indexOf("export async function readFlightRequest"), a.indexOf("export async function saveFlightRequest"));
    const order = ["requestTextProblem(text, linked.names)", '.from("ai_actions")\n    .insert(', "parseFlightRequest(requestText, today)", "draftFromReading(reading, today)"];
    let at = -1;
    for (const s of order) { const n = fn.indexOf(s, at + 1); assert.ok(n > at, s); at = n; }
    assert.match(fn, /action_kind: "Flight request",\s*status: "Proposed",\s*model: READER_VERSION,/);
    assert.match(fn, /cost_usd: 0,/);
    assert.match(fn, /status: "Failed", error: "reader-error"/);
    assert.equal(READER_VERSION, "local-parser-v1");
  });

  it("reads a 1,000-character request quickly, whatever is typed", () => {
    for (const text of ["to aaaa from bbbb ".repeat(55), "1 2 3 4 5 6 7 8 9 ".repeat(55), "15 jan ".repeat(140), "a".repeat(1000), "$1,".repeat(330)]) {
      const t0 = performance.now();
      parse(text.slice(0, MAX_REQUEST_CHARS));
      assert.ok(performance.now() - t0 < 1000, `slow on ${text.slice(0, 20)}`);
    }
  });
});

describe("the reader: route", () => {
  it("reads city names, airport codes and the common ways of writing a route", () => {
    for (const [text, origin, destination] of [
      ["Dubai to London", "DXB", "LON"],
      ["from Abu Dhabi to New York", "AUH", "NYC"],
      ["DXB-LHR", "DXB", "LHR"],
      ["dxb to lhr", "DXB", "LHR"],
      ["DXB → CDG", "DXB", "CDG"],
      ["to Karachi from Jeddah", "JED", "KHI"],
      ["Kuala Lumpur to Ho Chi Minh City", "KUL", "SGN"],
      ["São Paulo to Zürich", "SAO", "ZRH"],
      ["flying out of Mumbai into Doha", "BOM", "DOH"],
    ]) {
      const r = parse(text);
      assert.deepEqual([r.origin, r.destination], [origin, destination], text);
    }
  });

  it("asks instead of guessing: direction, unknown or ambiguous places, countries, stops, extra legs", () => {
    const bare = parse("Dubai London 15 Jan");
    assert.deepEqual([bare.origin, bare.destination], ["DXB", "LON"]);
    assert.ok(hasQuestion(bare, /Check the direction/));
    const one = parse("trip to somewhere nice");
    assert.equal(one.destination, null);
    assert.ok(hasQuestion(parse("Dubai please"), /Is Dubai \(DXB\) the departure or the arrival\?/));
    const typo = parse("Dubai to Londn on 5 Feb");
    assert.equal(typo.destination, null);
    assert.ok(hasQuestion(typo, /Did you mean London \(LON\)\?/));
    assert.ok(hasQuestion(parse("Dubai to Xanadu"), /"Xanadu" isn't in the airport list/));
    const brum = parse("Birmingham to Dubai");
    assert.equal(brum.origin, null);
    assert.ok(hasQuestion(brum, /Which Birmingham: BHX \(UK\) or BHM \(Alabama\)\?/));
    const india = parse("Dubai to India");
    assert.equal(india.destination, null);
    assert.ok(hasQuestion(india, /Which airport or city in India\?/));
    const via = parse("KHI to JED via DOH");
    assert.deepEqual([via.origin, via.destination], ["KHI", "JED"]);
    assert.ok(hasQuestion(via, /stop in DOH can't be saved/));
    assert.ok(hasQuestion(parse("Dubai to London to Paris"), /Only one route can be saved/));
  });

  it("doesn't read currencies, months, booking shorthand or the UAE as airports", () => {
    const r = parse("PAX 2 ADT, JAN 15, budget 900 USD, from the UAE");
    assert.equal(r.origin, null);
    assert.equal(r.destination, null);
    assert.ok(hasQuestion(r, /Which airport or city in UAE\?/));
  });
});

describe("the reader: dates", () => {
  const dates = (text) => { const r = parse(text); return [r.depart_on, r.return_on]; };

  it("reads written, numeric and relative dates, never in the past", () => {
    assert.deepEqual(dates("DXB-LHR 2027-01-15 back 2027-01-29"), ["2027-01-15", "2027-01-29"]);
    assert.deepEqual(dates("DXB-LHR 15/01/2027 return 29.01.27"), ["2027-01-15", "2027-01-29"]);
    assert.deepEqual(dates("DXB-LHR 15 Jan, returning 29th January"), ["2027-01-15", "2027-01-29"]);
    assert.deepEqual(dates("DXB-LHR Jan 15 to Jan 29"), ["2027-01-15", "2027-01-29"]);
    assert.deepEqual(dates("DXB-LHR 20-27 Dec"), ["2026-12-20", "2026-12-27"]);
    assert.deepEqual(dates("LHR-JFK dec 20 - jan 5"), ["2026-12-20", "2027-01-05"], "the return rolls into the next year");
    assert.deepEqual(dates("DXB-LHR 28 Nov back on the 3rd"), ["2026-11-28", "2026-12-03"]);
    assert.deepEqual(dates("DXB-LHR tomorrow, back Friday 4 December"), ["2026-11-28", "2026-12-04"]);
    assert.deepEqual(dates("DXB-LHR on 10 Nov one way"), ["2027-11-10", null], "a date without a year that has passed means next year");
    assert.deepEqual(dates("DXB-LHR on Monday one way"), ["2026-11-30", null]);
    assert.deepEqual(dates("DXB-LHR in 2 weeks one way"), ["2026-12-11", null]);
  });

  it("works out the return from the length of stay", () => {
    assert.deepEqual(dates("DXB-LHR 15 Jan for 10 nights"), ["2027-01-15", "2027-01-25"]);
    assert.deepEqual(dates("DXB-LHR 15 Jan for 2 weeks"), ["2027-01-15", "2027-01-29"]);
    const days = parse("DXB-LHR 15 Jan for 10 days");
    assert.equal(days.return_on, "2027-01-25");
    assert.ok(hasQuestion(days, /Check the return date: "10 days"/));
  });

  it("asks about day/month mix-ups, vague dates, 'next Friday', flexibility and missing returns", () => {
    const mix = parse("DXB-LHR 3/4 one way");
    assert.equal(mix.depart_on, null);
    assert.ok(hasQuestion(mix, /Is 3\/4 3 April \(day\/month\) or March 4 \(month\/day\)\?/));
    assert.equal(parse("DXB-LHR 25/12 one way").depart_on, "2026-12-25", "only one reading is possible");
    const vague = parse("DXB-LHR sometime in March");
    assert.equal(vague.depart_on, null);
    assert.ok(hasQuestion(vague, /Which day in March\?/));
    assert.ok(hasQuestion(parse("DXB-LHR next month"), /Which date\? The request only says "next month"/));
    assert.ok(hasQuestion(parse("DXB-LHR next Friday one way"), /"next friday" was read as 2026-12-04/));
    assert.ok(hasQuestion(parse("DXB-LHR around 15 Jan, back 29 Jan"), /Are the dates flexible\?/));
    assert.ok(hasQuestion(parse("DXB-LHR 15 Jan"), /Is it one-way\? No return date was given\./));
    assert.ok(hasQuestion(parse("DXB-LHR 15 Jan return trip"), /What is the return date\?/));
    const conflict = parse("DXB-LHR one way 15 Jan, back 29 Jan");
    assert.equal(conflict.return_on, null);
    assert.ok(hasQuestion(conflict, /says one-way but also gives a return date/));
    assert.ok(hasQuestion(parse("DXB-LHR 15 Jan, 20 Jan, 29 Jan"), /More than two dates/));
  });

  it("doesn't read amounts, passenger counts or flight numbers as dates", () => {
    const r = parse("DXB-LHR budget 12.500 EUR, 2-3 adults, EK001 one way");
    assert.equal(r.depart_on, null);
    assert.equal(r.budget_amount, 12500);
  });
});

describe("the reader: passengers", () => {
  const pax = (text) => { const r = parse(text); return [r.adults, r.children, r.infants]; };

  it("reads counts, words and ages", () => {
    assert.deepEqual(pax("2 adults 1 child 1 infant"), [2, 1, 1]);
    assert.deepEqual(pax("two adults and three kids"), [2, 3, null]);
    assert.deepEqual(pax("1 adult with a baby"), [1, null, 1]);
    assert.deepEqual(pax("me and my wife and 2 kids aged 5 and 8"), [2, 2, null]);
    assert.deepEqual(pax("2 adults, son aged 6 and a 10-month-old"), [2, 1, 1]);
    assert.deepEqual(pax("4 pax including 2 children"), [2, 2, null]);
    assert.deepEqual(pax("3 of us"), [3, null, null]);
    assert.deepEqual(pax("a couple"), [2, null, null]);
    assert.deepEqual(pax("travelling solo"), [1, null, null]);
    assert.deepEqual(pax("Dubai to London"), [null, null, null], "no count is invented");
  });

  it("asks when the split is unclear", () => {
    const fam = parse("family of 4");
    assert.equal(fam.adults, null);
    assert.ok(hasQuestion(fam, /How many of the 4 travellers are adults, children/));
    assert.ok(hasQuestion(parse("2 adults with kids"), /How many children/));
    assert.ok(hasQuestion(parse("2 adults and a 14 years old"), /14-year-old counts as an adult on flights/));
    assert.ok(hasQuestion(parse("5 people, 2 adults, 1 child"), /mentions 5 travellers but 2 adults, 1 children/));
  });
});

describe("the reader: cabin, airlines and budget", () => {
  it("reads the cabin, and asks when two are given", () => {
    for (const [text, cabin] of [["business class", "Business"], ["in business", "Business"], ["premium economy", "Premium economy"], ["economy", "Economy"], ["first class", "First"], ["fly first", "First"]]) {
      assert.equal(parse(`DXB-LHR ${text}`).cabin, cabin, text);
    }
    assert.equal(parse("DXB-LHR business trip, first week of March").cabin, null, "a business trip is not a cabin");
    assert.equal(parse("Riyadh to Cairo on business").cabin, null);
    const two = parse("DXB-LHR business or first");
    assert.equal(two.cabin, null);
    assert.ok(hasQuestion(two, /Which cabin class: Business or First\?/));
  });

  it("reads airline names and codes, and never an airline to avoid", () => {
    assert.deepEqual(parse("prefer Emirates or Qatar").preferred_airlines, ["EK", "QR"]);
    assert.deepEqual(parse("DXB-LHR EK or QR, BA ok").preferred_airlines, ["EK", "QR", "BA"]);
    assert.deepEqual(parse("Dubai to Doha, Qatar Airways").preferred_airlines, ["QR"]);
    assert.deepEqual(parse("fly to Qatar").preferred_airlines, [], "a country is not an airline");
    assert.deepEqual(parse("Dubai to Abu Dhabi, United Arab Emirates").preferred_airlines, []);
    assert.deepEqual(parse("from 9 AM, as soon as possible").preferred_airlines, [], "AM and AS are words here");
    const avoid = parse("Dubai to London, not Emirates, prefer BA");
    assert.deepEqual(avoid.preferred_airlines, ["BA"]);
    assert.ok(hasQuestion(avoid, /Airlines to avoid \(EK\)/));
  });

  it("reads the agent's budget (never a fare) and asks about currency or per-person amounts", () => {
    for (const [text, amount, currency] of [
      ["budget USD 9,000", 9000, "USD"],
      ["budget about $9k", 9000, "USD"],
      ["12500 AED", 12500, "AED"],
      ["under 3,000 dollars", 3000, "USD"],
      ["£1.5k", 1500, "GBP"],
      ["budget 4000 dirhams", 4000, "AED"],
    ]) {
      const r = parse(`DXB-LHR ${text}`);
      assert.deepEqual([r.budget_amount, r.budget_currency], [amount, currency], text);
    }
    const noCur = parse("DXB-LHR max budget 2000");
    assert.deepEqual([noCur.budget_amount, noCur.budget_currency], [2000, null]);
    assert.ok(hasQuestion(noCur, /Which currency is the budget in\?/));
    assert.ok(hasQuestion(parse("DXB-LHR 50000 rupees"), /"rupees" could mean more than one/));
    assert.ok(hasQuestion(parse("DXB-LHR budget 3k pounds per person"), /per person or for the whole trip/));
    assert.equal(parse("DXB-LHR, infant under 2, for 10 days").budget_amount, null, "counts and stays are not budgets");
    assert.ok(hasQuestion(parse("DXB-LHR USD 900 or USD 1200"), /Which budget: USD 900 or USD 1,200\?/));
  });
});

describe("the reader: whole requests end to end", () => {
  it("the panel's example becomes a complete draft with only the flexibility question", () => {
    const text = "2 adults and 1 child, Dubai to London around 15 Jan, back 29 Jan, business, prefer Emirates, budget about USD 9,000";
    assert.equal(personalDataProblem(text), null);
    const { draft, questions } = draftFromReading(parse(text), TODAY);
    assert.deepEqual(draft, {
      origin: "DXB", destination: "LON", departOn: "2027-01-15", returnOn: "2027-01-29", adults: "2", children: "1", infants: "0",
      cabin: "Business", preferredAirlines: "EK", budgetAmount: "9000", budgetCurrency: "USD",
    });
    assert.deepEqual(questions, ["Are the dates flexible? They were read as exact dates."]);
    assert.deepEqual(validateDraft(draft, TODAY), {});
  });

  it("a thin request gives a draft full of questions and nothing invented", () => {
    const { draft, questions } = draftFromReading(parse("need flights next month"), TODAY);
    assert.deepEqual([draft.origin, draft.destination, draft.departOn, draft.returnOn, draft.preferredAirlines, draft.budgetAmount], ["", "", "", "", "", ""]);
    for (const q of ["Which departure airport or city?", "Which arrival airport or city?", "What is the departure date?", "How many adults are travelling?", "Which cabin class?"]) {
      assert.ok(questions.includes(q), q);
    }
  });

  it("never throws, whatever is typed", () => {
    for (const t of ["", " ", "🙂✈️", "to", "from from to to", "$", "-", "31/31/31", "0 adults", "99 children", "\u0000‮", "the 31st", "Feb 30", "budget k"]) {
      const r = parse(t);
      assert.ok(Array.isArray(r.questions), t);
      draftFromReading(r, TODAY);
    }
  });

  it("the reading can't hold fares, flights, availability, PNRs or ticket numbers", () => {
    const r = parse("DXB-LHR 15 Jan fare 900 USD PNR ABC123 ticket 1761234567890 EK001 seats available");
    assert.deepEqual(Object.keys(r), ["origin", "destination", "depart_on", "return_on", "adults", "children", "infants", "cabin", "preferred_airlines", "budget_amount", "budget_currency", "questions"]);
    assert.ok(!JSON.stringify(r).includes("ABC123") && !JSON.stringify(r).includes("1761234567890"));
  });

  it("every place and airline in the lists has a valid code", () => {
    for (const [name, code] of Object.entries(PLACES)) assert.match(code, /^[A-Z]{3}$/, name);
    for (const a of AIRLINES) assert.match(a.code, /^[A-Z0-9]{2}$/, a.name);
  });
});

describe("draftFromReading: every value read is re-checked", () => {
  const good = {
    origin: "dxb",
    destination: "LON",
    depart_on: "2027-01-15",
    return_on: "2027-01-29",
    adults: 2,
    children: 1,
    infants: 0,
    cabin: "Business",
    preferred_airlines: ["ek", "QR", "EMIRATES", "ek"],
    budget_amount: 9000,
    budget_currency: "usd",
    questions: [],
  };

  it("keeps valid values (normalised) and asks nothing", () => {
    const { draft, questions } = draftFromReading(good, TODAY);
    assert.deepEqual(draft, {
      origin: "DXB", destination: "LON", departOn: "2027-01-15", returnOn: "2027-01-29", adults: "2", children: "1", infants: "0",
      cabin: "Business", preferredAirlines: "EK, QR", budgetAmount: "9000", budgetCurrency: "USD",
    });
    assert.deepEqual(questions, []);
  });

  it("turns missing or invalid values into blanks plus questions, never guesses", () => {
    const { draft, questions } = draftFromReading({ ...good, origin: null, destination: "LONDON", depart_on: "2025-01-01", return_on: "2027-01-10", adults: 0, infants: 3, cabin: "Luxury" }, TODAY);
    assert.equal(draft.origin, "");
    assert.equal(draft.destination, "");
    assert.equal(draft.departOn, "", "past dates are dropped");
    assert.equal(draft.adults, "1");
    assert.equal(draft.cabin, "Economy");
    for (const q of ["Which departure airport or city?", "Which arrival airport or city?", "What is the departure date?", "How many adults are travelling?", "How many infants (each infant needs an adult)?", "Which cabin class?"]) {
      assert.ok(questions.includes(q), q);
    }
  });

  it("a return before departure, the same airport twice, or an invalid date are dropped", () => {
    assert.equal(draftFromReading({ ...good, return_on: "2027-01-10" }, TODAY).draft.returnOn, "");
    assert.equal(draftFromReading({ ...good, destination: "DXB" }, TODAY).draft.destination, "");
    assert.equal(draftFromReading({ ...good, depart_on: "2027-02-30" }, TODAY).draft.departOn, "");
  });

  it("passes on the reader's own questions (trimmed, at most 8) and never throws on garbage", () => {
    assert.deepEqual(draftFromReading({ ...good, questions: ["  Which London airport? "] }, TODAY).questions, ["Which London airport?"]);
    for (const junk of [null, undefined, "text", 42, [], { adults: "two" }]) {
      const { draft } = draftFromReading(junk, TODAY);
      assert.equal(draft.cabin, "Economy");
    }
  });
});

describe("validateDraft: the agent's reviewed details", () => {
  const ok = { ...emptyDraft, origin: "DXB", destination: "LHR", departOn: "2027-01-15", returnOn: "", adults: "2", children: "0", infants: "1", cabin: "Economy" };
  it("accepts complete details (one-way, no budget)", () => assert.deepEqual(validateDraft(ok, TODAY), {}));
  it("refuses bad codes, past or reversed dates, counts out of range and infants above adults", () => {
    const e = validateDraft({ ...ok, origin: "DUBAI", destination: "DXB", departOn: "2026-01-01", adults: "0", infants: "3", preferredAirlines: "EK, EMIRATES", budgetAmount: "lots", budgetCurrency: "US" }, TODAY);
    for (const k of ["origin", "departOn", "adults", "preferredAirlines", "budgetAmount", "budgetCurrency"]) assert.ok(e[k], k);
    assert.equal(validateDraft({ ...ok, infants: "3" }, TODAY).infants, "Each infant needs an adult.");
    assert.equal(validateDraft({ ...ok, returnOn: "2027-01-10" }, TODAY).returnOn, "The return is before the departure.");
  });
});

describe("saving: only reviewed, approved details; never 'searched'", () => {
  it("the saved row is a search request, marked not searched, linked to the reading", () => {
    const row = searchRow({ ...emptyDraft, origin: "dxb", destination: "lhr", departOn: "2027-01-15", adults: "2", preferredAirlines: "ek, qr", budgetAmount: "9,000", budgetCurrency: "usd" }, "a1", ["Which London airport?"]);
    assert.equal(row.origin, "DXB");
    assert.equal(row.request.searched, false);
    assert.equal(row.request.ai_action_id, "a1");
    assert.deepEqual(row.request.preferred_airlines, ["EK", "QR"]);
    assert.deepEqual(row.request.budget, { amount: 9000, currency: "USD" });
    assert.ok(!("provider" in row), "provider stays the default (not searched by a supplier)");
  });

  it("the server action refuses to save without the review confirmation, and only the agent's own Proposed reading", () => {
    const a = read("src/lib/actions/flight-requests.ts");
    const save = a.slice(a.indexOf("export async function saveFlightRequest"), a.indexOf("export async function discardFlightRequest"));
    assert.match(save, /^export async function saveFlightRequest[^{]*\{\s*if \(reviewed !== true\) return \{ ok: false, message: "Confirm that you've reviewed the details before saving\." \};/);
    assert.match(save, /action\.action_kind !== "Flight request" \|\| action\.requested_by !== user\.id/);
    assert.match(save, /if \(action\.status !== "Proposed"\) return/);
    assert.match(save, /const fieldErrors = validateDraft\(v, todayUtc\(\)\);/);
    const order = ["validateDraft(v", 'from("flight_searches")', 'status: "Applied"'];
    let at = -1;
    for (const s of order) { const n = save.indexOf(s, at + 1); assert.ok(n > at, s); at = n; }
  });

  it("only the roles that may create flight searches can read requests", () => {
    assert.match(read("src/lib/actions/flight-requests.ts"), /const ALLOWED: AppRole\[\] = \["admin", "sales_manager", "sales_agent", "ticketing_agent"\];/);
  });

  it("the panel only saves after the review box is ticked, and shows no fares", () => {
    const ui = read("src/components/flights/FlightRequestPanel.tsx");
    assert.match(ui, /if \(Object\.keys\(errors\)\.length \|\| !reviewed\) return;/);
    assert.match(ui, /saveFlightRequest\(reading\.actionId, draft, link, reviewed\)/);
    assert.match(ui, /Don&apos;t include names, phone numbers, e-mail addresses, passport or other ID numbers/);
    assert.match(ui, /It never shows fares or availability\./);
    assert.ok(!/formatMoney|\bfare\b(?! or| Not)/i.test(ui.replace(/never shows fares|no fares are shown/gi, "")), "no fare display");
    assert.ok(!/\bAI\b/.test(ui.replace(/^\/\/.*$/gm, "")), "the panel no longer mentions AI");
  });

  it("no code in src shows or stores fares from a reading", () => {
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(ts|tsx)$/.test(n) && files.push(join(d, n))));
    walk(fileURLToPath(new URL("../../src", import.meta.url)));
    for (const f of files.filter((x) => /flight-request|FlightRequestPanel|travel-codes/.test(x))) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/flight_offers|\bfare_?(amount|price)?\s*[:=]/i.test(src), `${f} must not write offers or fares`);
    }
  });

  it("daily limit matches the database", () => {
    assert.equal(DAILY_LIMIT, 50);
    assert.ok(read("supabase/migrations/20261120002500_ai_flight_requests.sql").includes("daily_limit constant integer := 50;"));
  });

  it("no API key is committed anywhere in the project's source", () => {
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : files.push(join(d, n))));
    for (const dir of ["src", "supabase/migrations", "scripts"]) walk(fileURLToPath(new URL(`../../${dir}`, import.meta.url)));
    for (const f of files) assert.ok(!/sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{32,}/.test(readFileSync(f, "utf8")), f);
  });
});
