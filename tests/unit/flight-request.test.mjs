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
  draftFromInput,
  draftFromReading,
  emptyDraft,
  MAX_REQUEST_CHARS,
  personalDataProblem,
  requestTextProblem,
  searchRow,
  validateDraft,
} from "@/lib/flight-request";
import { parseFlightRequest, READER_VERSION } from "@/lib/flight-request-parser";
import { AIRLINES, AMBIGUOUS_PLACES, PLACES, REGIONS } from "@/lib/travel-codes";

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
    assert.equal(READER_VERSION, "local-parser-v2");
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
    assert.ok(hasQuestion(india, /Which airport in India: DEL \(Delhi\), BOM \(Mumbai\)/));
    assert.ok(hasQuestion(parse("Dubai to London, also Paris"), /also mentions Paris \(PAR\): is that part of the trip\?/));
    assert.ok(hasQuestion(parse("DXB to XQZ"), /XQZ isn't in the airport list: check the code/));
    assert.equal(parse("Dubai to Abu Dhabi, United Arab Emirates").questions.some((x) => /United Arab Emirates/.test(x)), false, "a country after a city only qualifies it");
  });

  it("doesn't read currencies, months, booking shorthand or the UAE as airports", () => {
    const r = parse("PAX 2 ADT, JAN 15, budget 900 USD, from the UAE");
    assert.equal(r.origin, null);
    assert.equal(r.destination, null);
    assert.ok(hasQuestion(r, /Which airport in UAE: DXB \(Dubai\), AUH \(Abu Dhabi\), SHJ \(Sharjah\)\?/));
  });

  it("reads airport names, booking-system routes and international place names", () => {
    for (const [text, origin, destination] of [
      ["Heathrow to JFK", "LHR", "JFK"],
      ["Changi to Hamad", "SIN", "DOH"],
      ["DXBLHR 15JAN", "DXB", "LHR"],
      ["Gatwick to Malaga", "LGW", "AGP"],
      ["Lagos to Johannesburg", "LOS", "JNB"],
      ["Toronto to Bogotá", "YTO", "BOG"],
      ["Auckland to Nadi", "AKL", "NAN"],
      ["Almaty to Tbilisi", "ALA", "TBS"],
      ["Medina to Islamabad", "MED", "ISB"],
      ["Casablanca to Marrakech", "CMN", "RAK"],
    ]) {
      const r = parse(text);
      assert.deepEqual([r.origin, r.destination], [origin, destination], text);
      assert.ok(!hasQuestion(r, /Check the direction/), text);
    }
  });
});

describe("the reader: one-way, return and multi-city", () => {
  it("tells one-way, return and multi-city apart", () => {
    assert.equal(parse("DXB-LHR 15 Jan one way").trip_type, "One-way");
    assert.equal(parse("DXB-LHR 15 Jan, back 29 Jan").trip_type, "Return");
    assert.equal(parse("DXB-LHR-DXB 15JAN 29JAN").trip_type, "Return");
    assert.equal(parse("London to Dubai and back to London, 3 Feb - 10 Feb").trip_type, "Return");
    const rt = parse("Dubai to London round trip 15 Jan");
    assert.equal(rt.trip_type, "Return");
    assert.ok(hasQuestion(rt, /What is the return date\?/));
  });

  it("reads every flight of a multi-city trip with its own date", () => {
    const r = parse("Dubai to London on 15 Jan, then London to Paris on 20 Jan, then Paris to Dubai on 27 Jan");
    assert.equal(r.trip_type, "Multi-city");
    assert.deepEqual([r.origin, r.destination, r.depart_on, r.return_on], ["DXB", "LON", "2027-01-15", null]);
    assert.deepEqual(r.legs, [
      { origin: "LON", destination: "PAR", depart_on: "2027-01-20" },
      { origin: "PAR", destination: "DXB", depart_on: "2027-01-27" },
    ]);
    const open = parse("DXB-LHR 15 Jan, CDG-DXB 29 Jan");
    assert.equal(open.trip_type, "Multi-city", "open jaw");
    assert.deepEqual(open.legs, [{ origin: "CDG", destination: "DXB", depart_on: "2027-01-29" }]);
    assert.deepEqual(parse("Dubai to London then to Paris, 15 Jan and 20 Jan").legs, [{ origin: "LON", destination: "PAR", depart_on: "2027-01-20" }]);
  });

  it("asks when flights and dates don't line up, or the words disagree", () => {
    assert.ok(hasQuestion(parse("Dubai to London, London to Paris, 15 Jan"), /Not every flight has a date/));
    assert.ok(hasQuestion(parse("multi-city trip from Dubai to London"), /List each flight of the multi-city trip/));
    assert.ok(hasQuestion(parse("one way Dubai to London to Paris"), /says one-way but describes more than one flight/));
    const stopover = parse("London to Bangkok with a 2 night stopover in Dubai");
    assert.ok(hasQuestion(stopover, /stopover of a night or more in Dubai \(DXB\) is a separate flight/));
    assert.deepEqual(stopover.via, []);
  });
});

describe("the reader: connections, stops and direct flights", () => {
  it("reads direct flights, stop limits, connection airports and connection times", () => {
    assert.equal(parse("DXB-LHR direct").stops, "Direct only");
    assert.equal(parse("DXB-LHR non-stop please").stops, "Direct only");
    assert.equal(parse("DXB-SYD max 1 stop").stops, "Up to 1 stop");
    assert.equal(parse("DXB-LAX one stop is fine").stops, "Up to 1 stop");
    assert.equal(parse("DXB-LIM up to 2 stops").stops, "Up to 2 stops");
    const via = parse("Mumbai to New York via Doha, layover under 4 hours");
    assert.deepEqual([via.origin, via.destination], ["BOM", "NYC"]);
    assert.deepEqual(via.via, ["DOH"]);
    assert.equal(via.max_connection_hours, 4);
    assert.deepEqual(parse("KHI to JED connecting in Dubai").via, ["DXB"]);
    assert.deepEqual(parse("DXB-JFK, no overnight layover").notes, ["No overnight connections"]);
  });

  it("asks when a direct flight is also given a connection", () => {
    assert.ok(hasQuestion(parse("DXB-LHR direct via Doha"), /A direct flight can't connect in DOH/));
  });
});

describe("the reader: time of day", () => {
  it("reads outbound and return time preferences", () => {
    const r = parse("DXB-LHR 15 Jan evening departure, back 29 Jan morning");
    assert.deepEqual([r.depart_time, r.return_time], ["Evening", "Morning"]);
    assert.equal(parse("KHI-JED one way 15 Jan after 6pm").depart_time, "After 18:00");
    assert.equal(parse("KHI-JED one way 15 Jan before 10:30").depart_time, "Before 10:30");
    assert.equal(parse("LHR-DXB red-eye on 3 Feb one way").depart_time, "Night");
    assert.deepEqual(parse("DXB-LHR one way 15 Jan, arrive by 9am").notes, ["Arrive by 09:00"]);
  });

  it("asks about a bare hour, and doesn't read dates, counts or greetings as times", () => {
    assert.ok(hasQuestion(parse("DXB-LHR 15 Jan one way after 6"), /Is "after 6" in the morning or the evening\?/));
    const r = parse("Good morning, from 15 Jan DXB-LHR, 2 adults, a 2 night stay one way");
    assert.equal(r.depart_time, null);
    assert.equal(r.depart_on, "2027-01-15");
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

  it("reads international date formats", () => {
    assert.deepEqual(dates("DXB-LHR 15JAN27 29JAN27"), ["2027-01-15", "2027-01-29"], "booking-system style");
    assert.deepEqual(dates("DXB-LHR 15.01. - 22.01."), ["2027-01-15", "2027-01-22"], "day.month.");
    assert.deepEqual(dates("JFK-LHR 01/15/2027 one way"), ["2027-01-15", null], "US month/day when the day is over 12");
    assert.deepEqual(dates("DXB-LHR 2027/01/15 one way"), ["2027-01-15", null]);
    assert.deepEqual(dates("DXB-LHR Thu, 15 January 2027 one way"), ["2027-01-15", null]);
    assert.deepEqual(dates("DXB-LHR January the 15th one way"), ["2027-01-15", null]);
    assert.deepEqual(dates("MAD-BOG 15 enero, regreso 22 enero"), ["2027-01-15", "2027-01-22"], "Spanish months");
    assert.deepEqual(dates("CDG-DXB du 3 au 10 fevrier"), ["2027-02-03", "2027-02-10"], "French range");
    assert.deepEqual(dates("MUC-DXB 15. Marz one way"), ["2027-03-15", null], "German month");
  });

  it("reads date flexibility, and tells flexible dates from a flexible ticket", () => {
    assert.equal(parse("DXB-LHR 15 Jan ± 3 days").flexible_days, 3);
    assert.equal(parse("DXB-LHR 15 Jan +/- 2 days").flexible_days, 2);
    assert.equal(parse("DXB-LHR 15 Jan, 3 days either side").flexible_days, 3);
    assert.equal(parse("DXB-LHR 15 Jan, exact dates").flexible_days, 0);
    const flex = parse("DXB-LHR 15 Jan, flexible dates");
    assert.equal(flex.flexible_days, null);
    assert.ok(hasQuestion(flex, /How many days either side/));
    const ticket = parse("DXB-LHR 15 Jan, flexible ticket");
    assert.deepEqual(ticket.fare_rules, ["Changeable"]);
    assert.equal(ticket.flexible_days, null);
    assert.ok(hasQuestion(parse("DXB-LHR 15 Jan, flexible"), /Flexible dates, or a changeable ticket\?/));
    assert.ok(hasQuestion(parse("DXB-LHR during Eid holidays"), /Which date\? The request only says "eid holidays"/));
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
    assert.deepEqual(pax("2ADT 1CHD 1INF"), [2, 1, 1], "booking shorthand");
    assert.deepEqual(pax("2 adults, kids (4, 9)"), [2, 2, null]);
    assert.deepEqual(pax("1 adult, infant 11 months"), [1, null, 1]);
    assert.deepEqual(pax("2 adults with children 3 and 7 and a 6 month old"), [2, 2, 1]);
    assert.deepEqual(pax("DXB-LHR in 2 months"), [null, null, null], "'in 2 months' is not an infant's age");
  });

  it("checks ages against the passenger types", () => {
    assert.ok(hasQuestion(parse("1 adult and an infant aged 3"), /Infants are under 2/));
    assert.ok(hasQuestion(parse("2 adults, 3 infants"), /Each infant \(on a lap\) needs its own adult/));
    assert.ok(hasQuestion(parse("2 adults and a teenager"), /teenager \(12\+\) counts as an adult/));
    assert.ok(hasQuestion(parse("2 adults and a toddler"), /toddler is an infant under 2 and a child from 2/));
    const um = parse("unaccompanied minor aged 9 DXB-LHR");
    assert.ok(um.notes.includes("Unaccompanied minor"));
    assert.ok(hasQuestion(um, /needs the airline's UM service/));
  });

  it("keeps special requests as notes for the agent, never as confirmed services", () => {
    const r = parse("DXB-LHR one way 15 Jan, 1 adult, wheelchair, vegetarian meal, window seat, infant with own seat, travelling with a pet");
    assert.deepEqual(r.notes, ["Infant with own seat", "Wheelchair / mobility assistance", "Travelling with a pet: confirm the airline's rules", "Special meal: vegetarian", "Seat request: window"]);
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
    for (const [text, cabin] of [["J class", "Business"], ["upper class", "Business"], ["Qsuite", "Business"], ["W class", "Premium economy"], ["coach", "Economy"], ["main cabin", "Economy"], ["La Premiere", "First"]]) {
      assert.equal(parse(`DXB-LHR ${text}`).cabin, cabin, text);
    }
    const plus = parse("DXB-LHR economy plus");
    assert.equal(plus.cabin, "Economy");
    assert.ok(plus.notes.includes("Extra-legroom economy (Economy Plus / Comfort)"));
    assert.ok(hasQuestion(parse("DXB-LHR business outbound, economy return"), /Mixed cabins \(Business, Economy\) can't be saved in one search/));
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
    assert.deepEqual(avoid.notes, ["Avoid airline EK"]);
    for (const [text, codes] of [
      ["prefer Singapore Airlines or Cathay Pacific", ["SQ", "CX"]],
      ["Turkish Airlines, Lufthansa or Air India", ["TK", "LH", "AI"]],
      ["IndiGo or Air India Express", ["6E", "IX"]],
      ["with Ethiopian or Kenya Airways", ["ET", "KQ"]],
      ["fly Qantas or LATAM", ["QF", "LA"]],
      ["airline: AI", ["AI"]],
    ]) {
      assert.deepEqual(parse(`DXB-SYD ${text}`).preferred_airlines, codes, text);
    }
    assert.deepEqual(parse("DXB-LHR any airline").preferred_airlines, []);
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

describe("the reader: baggage and fare conditions are requirements, never allowances", () => {
  it("reads what baggage the customer needs", () => {
    const two = parse("DXB-LHR 2 x 23kg bags");
    assert.deepEqual([two.baggage, two.checked_bags, two.baggage_note], ["Checked bags", 2, "2 × 23 kg"]);
    const one = parse("DXB-LHR 1 checked bag");
    assert.deepEqual([one.baggage, one.checked_bags], ["Checked bags", 1]);
    assert.equal(parse("DXB-LHR hand luggage only").baggage, "Cabin bag only");
    assert.equal(parse("DXB-LHR no checked baggage").baggage, "Cabin bag only");
    assert.equal(parse("DXB-LHR with baggage please").baggage, "Checked bags");
    assert.deepEqual([parse("DXB-LHR 30kg").baggage, parse("DXB-LHR 30kg").baggage_note], ["Checked bags", "30 kg"]);
    assert.equal(parse("DXB-LHR a bag").baggage, null, "'a bag' could be a cabin bag");
    assert.ok(parse("DXB-LHR golf clubs").notes.includes("Sports equipment to check in: confirm the airline's rules"));
  });

  it("never states an allowance: asks instead", () => {
    const r = parse("DXB-LHR 15 Jan, how much baggage is included?");
    assert.equal(r.baggage, null);
    assert.ok(hasQuestion(r, /Baggage allowances depend on the airline and fare, so they can't be confirmed until a fare is quoted/));
  });

  it("reads the fare conditions asked for, and never states a rule", () => {
    assert.deepEqual(parse("DXB-LHR refundable").fare_rules, ["Refundable"]);
    assert.deepEqual(parse("DXB-LHR non-refundable is fine, cheapest").fare_rules, ["Restrictions OK", "Lowest fare"]);
    assert.deepEqual(parse("DXB-LHR free date change").fare_rules, ["Changeable"]);
    assert.deepEqual(parse("DXB-LHR fully refundable and changeable").fare_rules, ["Refundable", "Changeable"]);
    assert.ok(hasQuestion(parse("DXB-LHR refundable but cheapest"), /Refundable fares usually cost more than the lowest fare/));
    assert.ok(hasQuestion(parse("DXB-LHR what's the cancellation policy?"), /Fare rules .* depend on the fare/));
  });

  it("says that fares, availability, PNRs and tickets come from elsewhere", () => {
    const r = parse("DXB-BOM tomorrow, what's the fare? any seats available? PNR please");
    assert.ok(hasQuestion(r, /Fares aren't shown here/));
    assert.ok(hasQuestion(r, /Seat availability isn't known here/));
    assert.ok(hasQuestion(r, /PNRs and ticket numbers come from the airline after booking/));
    assert.ok(!hasQuestion(parse("DXB-BOM tomorrow, cheapest fare"), /Fares aren't shown here/), "'cheapest fare' is a preference");
    assert.ok(hasQuestion(parse("DXB-LHR, transit visa?"), /Visas and transit visas depend on the passengers' nationalities/));
  });
});

describe("the reader: whole requests end to end", () => {
  it("the panel's example becomes a complete draft with only the flexibility question", () => {
    const text = "2 adults and 1 child, Dubai to London around 15 Jan, back 29 Jan, business, prefer Emirates, budget about USD 9,000";
    assert.equal(personalDataProblem(text), null);
    const { draft, questions } = draftFromReading(parse(text), TODAY);
    assert.deepEqual(draft, {
      ...emptyDraft, tripType: "Return", origin: "DXB", destination: "LON", departOn: "2027-01-15", returnOn: "2027-01-29", legs: [],
      adults: "2", children: "1", infants: "0", cabin: "Business", preferredAirlines: "EK", budgetAmount: "9000", budgetCurrency: "USD",
    });
    assert.deepEqual(questions, ["Are the dates flexible? They were read as exact dates; say how many days either side."]);
    assert.deepEqual(validateDraft(draft, TODAY), {});
  });

  it("a detailed international request fills every field", () => {
    const text = "DXBLHR 15/01/2027 evening, return 29/01/2027 morning, 2 adults 1 child aged 7, J class, direct, BA or EK, 2 x 23kg bags, refundable, ± 2 days, budget AED 30,000, vegetarian meal";
    assert.equal(personalDataProblem(text), null);
    const { draft, questions } = draftFromReading(parse(text), TODAY);
    assert.deepEqual(draft, {
      tripType: "Return", origin: "DXB", destination: "LHR", departOn: "2027-01-15", returnOn: "2027-01-29", legs: [], flexibleDays: "2",
      adults: "2", children: "1", infants: "0", cabin: "Business", stops: "Direct only", via: "", maxConnectionHours: "",
      departTime: "Evening", returnTime: "Morning", preferredAirlines: "BA, EK", baggage: "Checked bags", checkedBags: "2",
      baggageNote: "2 × 23 kg", fareRules: "Refundable", budgetAmount: "30000", budgetCurrency: "AED", notes: "Special meal: vegetarian",
    });
    assert.deepEqual(questions, []);
    assert.deepEqual(validateDraft(draft, TODAY), {});
  });

  it("a multi-city request becomes a valid multi-city draft", () => {
    const { draft } = draftFromReading(parse("Dubai to London on 15 Jan, then London to Paris on 20 Jan, then Paris to Dubai on 27 Jan, 2 adults, economy"), TODAY);
    assert.equal(draft.tripType, "Multi-city");
    assert.deepEqual(draft.legs, [{ origin: "LON", destination: "PAR", departOn: "2027-01-20" }, { origin: "PAR", destination: "DXB", departOn: "2027-01-27" }]);
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

  it("the reading can't hold fares, flights, availability, allowances, PNRs or ticket numbers", () => {
    const r = parse("DXB-LHR 15 Jan fare 900 USD PNR ABC123 ticket 1761234567890 EK001 seats available 23kg allowance");
    const keys = Object.keys(r);
    assert.deepEqual(keys, [
      "trip_type", "origin", "destination", "depart_on", "return_on", "legs", "flexible_days", "adults", "children", "infants", "cabin",
      "stops", "via", "max_connection_hours", "depart_time", "return_time", "preferred_airlines", "baggage", "checked_bags",
      "baggage_note", "fare_rules", "budget_amount", "budget_currency", "notes", "questions",
    ]);
    assert.ok(!keys.some((k) => /fare_?(amount|price)?$|price|cost|flight_?n|seat|availab|allowance|pnr|ticket|locator/i.test(k)));
    assert.ok(!JSON.stringify(r).includes("ABC123") && !JSON.stringify(r).includes("1761234567890"));
  });

  it("the lists are well formed: valid codes, no clashes", () => {
    for (const [name, code] of Object.entries(PLACES)) {
      assert.match(code, /^[A-Z]{3}$/, name);
      assert.equal(name, name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""), `${name}: lower case, no accents`);
      assert.ok(!(name in REGIONS) && !(name in AMBIGUOUS_PLACES), `${name} is in one list only`);
    }
    for (const [name, codes] of Object.entries(REGIONS)) for (const c of codes) assert.match(c, /^[A-Z]{3}$/, name);
    for (const a of AIRLINES) assert.match(a.code, /^[A-Z0-9]{2}$/, a.name);
    assert.equal(new Set(AIRLINES.map((a) => a.name)).size, AIRLINES.length, "no airline listed twice");
    assert.ok(Object.keys(PLACES).length >= 600, "major international cities and airports");
    assert.ok(AIRLINES.length >= 200, "international airlines");
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
      ...emptyDraft, tripType: "Return", origin: "DXB", destination: "LON", departOn: "2027-01-15", returnOn: "2027-01-29", legs: [],
      adults: "2", children: "1", infants: "0", cabin: "Business", preferredAirlines: "EK, QR", budgetAmount: "9000", budgetCurrency: "USD",
    });
    assert.deepEqual(questions, []);
  });

  it("re-checks the new preferences: only listed values, sane numbers, no direct flight with a connection", () => {
    const { draft, questions } = draftFromReading({
      ...good, stops: "Direct only", via: ["doh", "XXXX", "DXB"], max_connection_hours: 40, depart_time: "After 25:00", return_time: "Morning",
      baggage: "Checked bags", checked_bags: 12, baggage_note: "x".repeat(80), fare_rules: ["Refundable", "Free upgrade"], flexible_days: 4,
      notes: ["Window seat", 7, "\u0007bell"], trip_type: "Return",
    }, TODAY);
    assert.deepEqual(
      [draft.via, draft.maxConnectionHours, draft.departTime, draft.returnTime, draft.checkedBags, draft.baggageNote.length, draft.fareRules, draft.flexibleDays, draft.notes],
      ["DOH", "", "", "Morning", "", 60, "Refundable", "7", "Window seat\nbell"],
    );
    assert.ok(questions.includes("A direct flight can't connect in DOH: which is it?"));
  });

  it("checks every further flight of a multi-city trip", () => {
    const { draft, questions } = draftFromReading({ ...good, return_on: null, trip_type: "Multi-city", legs: [{ origin: "LON", destination: "PAR", depart_on: "2027-01-10" }, { origin: "PAR", destination: "PAR", depart_on: "2027-01-20" }] }, TODAY);
    assert.equal(draft.tripType, "Multi-city");
    assert.deepEqual(draft.legs, [{ origin: "LON", destination: "PAR", departOn: "" }, { origin: "PAR", destination: "PAR", departOn: "2027-01-20" }]);
    assert.ok(questions.includes("Flight 2: what is the date?"), "a date before the previous flight is dropped");
    assert.ok(questions.includes("Flight 3: which airports?"));
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

  it("passes on the reader's own questions (trimmed, at most 12) and never throws on garbage", () => {
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
    assert.equal(validateDraft({ ...ok, tripType: "Return", returnOn: "2027-01-10" }, TODAY).returnOn, "The return is before the departure.");
  });

  it("matches the trip type: a return needs a return date, one-way has none, multi-city needs valid flights in order", () => {
    assert.equal(validateDraft({ ...ok, tripType: "Return" }, TODAY).returnOn, "Enter the return date, or choose one-way.");
    assert.equal(validateDraft({ ...ok, returnOn: "2027-01-20" }, TODAY).returnOn, "Only a return trip has a return date.");
    assert.deepEqual(validateDraft({ ...ok, tripType: "Return", returnOn: "2027-01-20", returnTime: "Evening" }, TODAY), {});
    const multi = { ...ok, tripType: "Multi-city", legs: [{ origin: "LHR", destination: "CDG", departOn: "2027-01-20" }] };
    assert.deepEqual(validateDraft(multi, TODAY), {});
    assert.equal(validateDraft({ ...multi, legs: [] }, TODAY).legs, "Add at least one more flight, or choose one-way.");
    assert.equal(validateDraft({ ...multi, legs: [{ origin: "LHR", destination: "CDG", departOn: "2027-01-10" }] }, TODAY).legs, "Flight 2: the date is before the previous flight.");
    assert.equal(validateDraft({ ...multi, legs: [{ origin: "LHR", destination: "LHR", departOn: "2027-01-20" }] }, TODAY).legs, "Flight 2: arrival must differ from departure.");
    assert.equal(validateDraft({ ...multi, legs: Array(6).fill(multi.legs[0]) }, TODAY).legs, "At most 6 flights.");
    assert.equal(validateDraft({ ...ok, legs: multi.legs }, TODAY).legs, "Only a multi-city trip has further flights.");
  });

  it("checks the preferences", () => {
    const e = validateDraft({
      ...ok, stops: "Direct only", via: "DOH", maxConnectionHours: "30", departTime: "late", returnTime: "Morning", flexibleDays: "5",
      baggage: "Cabin bag only", checkedBags: "2", fareRules: "Refundable, Free", notes: "x".repeat(101),
    }, TODAY);
    for (const k of ["via", "maxConnectionHours", "departTime", "returnTime", "flexibleDays", "checkedBags", "fareRules", "notes"]) assert.ok(e[k], k);
    assert.deepEqual(validateDraft({ ...ok, stops: "Up to 1 stop", via: "doh, ist", maxConnectionHours: "6", departTime: "After 18:00", baggage: "Checked bags", checkedBags: "2", fareRules: "Refundable, Changeable", flexibleDays: "3" }, TODAY), {});
  });

  it("rebuilds the form from the browser safely: unknown fields dropped, sizes capped", () => {
    const v = draftFromInput({ tripType: "Return", origin: "DXB", cabin: "Luxury", stops: "Teleport", legs: [{ origin: "LHR", destination: 5 }, "x"], notes: "n".repeat(5000), evil: "<script>" });
    assert.equal(v.tripType, "Return");
    assert.equal(v.cabin, "");
    assert.equal(v.stops, "");
    assert.deepEqual(v.legs, [{ origin: "LHR", destination: "", departOn: "" }, { origin: "", destination: "", departOn: "" }]);
    assert.equal(v.notes.length, 1200);
    assert.ok(!("evil" in v));
    assert.equal(draftFromInput(null).budgetCurrency, "USD");
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
    assert.equal(row.return_on, null);
    assert.equal(row.request.baggage_requested, null);
  });

  it("keeps the customer's preferences in the request, labelled as requests", () => {
    const row = searchRow({
      ...emptyDraft, tripType: "Multi-city", origin: "DXB", destination: "LHR", departOn: "2027-01-15", returnOn: "",
      legs: [{ origin: "lhr", destination: "cdg", departOn: "2027-01-20" }], flexibleDays: "2", stops: "Up to 1 stop", via: "doh",
      maxConnectionHours: "5", departTime: "Evening", baggage: "Checked bags", checkedBags: "2", baggageNote: "2 × 23 kg",
      fareRules: "Refundable, Changeable", notes: "Window seat\n\nVegetarian meal",
    }, "a1", []);
    assert.equal(row.return_on, null);
    assert.deepEqual(row.request.further_legs, [{ origin: "LHR", destination: "CDG", depart_on: "2027-01-20" }]);
    assert.deepEqual(
      [row.request.trip_type, row.request.flexible_days, row.request.stops, row.request.via, row.request.max_connection_hours, row.request.time_preferences],
      ["Multi-city", 2, "Up to 1 stop", ["DOH"], 5, { outbound: "Evening", return: null }],
    );
    assert.deepEqual(row.request.baggage_requested, { need: "Checked bags", checked_bags: 2, note: "2 × 23 kg" });
    assert.deepEqual(row.request.fare_conditions_requested, ["Refundable", "Changeable"]);
    assert.deepEqual(row.request.notes, ["Window seat", "Vegetarian meal"]);
    assert.ok(!JSON.stringify(row).match(/allowance|"fare"|price|pnr|ticket_number/i), "nothing that reads as a confirmed allowance, fare or ticket");
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
    // "Fare conditions the customer asked for" are requests, not prices.
    assert.ok(!/formatMoney|\bfare\b(?! or| Not)/i.test(ui.replace(/never shows fares|no fares are shown|fare conditions|a quoted fare/gi, "")), "no fare display");
    assert.match(ui, /Baggage and fare conditions are what the customer asked for, not confirmed allowances or rules/);
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
