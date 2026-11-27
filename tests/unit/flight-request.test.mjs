// Phase 3: AI reading of flight requests. No AI calls are made here (no cost): the pure logic is tested
// directly and the wiring of the server action, AI module and panel is checked in the source.
// Database side (log, daily limit, personal-data backstop): supabase/tests section 26.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_MODEL,
  aiErrorLog,
  aiFailureReason,
  DAILY_LIMIT,
  draftFromAi,
  emptyDraft,
  estimateCostUsd,
  EXTRACTION_SCHEMA,
  MAX_REQUEST_CHARS,
  personalDataProblem,
  requestTextProblem,
  searchRow,
  SYSTEM_PROMPT,
  userMessage,
  validateDraft,
} from "@/lib/flight-request";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-11-27";

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

describe("no personal data is sent to the AI", () => {
  it("refuses e-mail addresses, phone / ID numbers and passport-style numbers", () => {
    for (const t of REFUSED) assert.ok(personalDataProblem(t), t);
  });

  it("allows ordinary trip details", () => {
    for (const t of ALLOWED) assert.equal(personalDataProblem(t), null, t);
  });

  it("refuses the linked customer's or lead's name (accents and case ignored)", () => {
    assert.equal(personalDataProblem("Amélie Hartley wants DXB to LHR", ["Amelie Hartley"]), "Remove the customer's name: the AI only needs the trip details.");
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

  it("only the request text and today's date go to the AI (no lead, customer or agent details)", () => {
    assert.equal(userMessage("DXB to LHR", TODAY), "Today's date: 2026-11-27\n\nFlight request:\nDXB to LHR");
    const ai = read("src/lib/ai/flight-request-ai.ts");
    assert.match(ai, /messages: \[\{ role: "user", content: userMessage\(text, today\) \}\],/);
    const actions = read("src/lib/actions/flight-requests.ts");
    assert.match(actions, /const reading = await readFlightRequestWithAi\(requestText, today\);/);
  });
});

describe("the AI can't produce fares, flights or availability", () => {
  it("its answer format has no price, fare, flight, schedule or availability fields", () => {
    const keys = Object.keys(EXTRACTION_SCHEMA.properties);
    assert.deepEqual(keys, ["origin", "destination", "depart_on", "return_on", "adults", "children", "infants", "cabin", "preferred_airlines", "budget_amount", "budget_currency", "questions"]);
    assert.ok(!keys.some((k) => /fare|price|cost|flight_?n|schedule|seat|availab|carrier|time/i.test(k)));
    assert.equal(EXTRACTION_SCHEMA.additionalProperties, false);
    assert.deepEqual([...EXTRACTION_SCHEMA.required].sort(), [...keys].sort(), "every field is required (structured outputs)");
  });

  it("the instructions forbid fares and names, and ask questions instead of guessing", () => {
    assert.match(SYSTEM_PROMPT, /You do not have access to fares, schedules or availability, and you must not mention or estimate any\./);
    assert.match(SYSTEM_PROMPT, /Do not include names or other personal details/);
    assert.match(SYSTEM_PROMPT, /add a short question for the agent instead of guessing/);
  });

  it("no code in src shows or stores fares from the AI", () => {
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(ts|tsx)$/.test(n) && files.push(join(d, n))));
    walk(fileURLToPath(new URL("../../src", import.meta.url)));
    for (const f of files.filter((x) => /flight-request|FlightRequestPanel/.test(x))) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/flight_offers|\bfare_?(amount|price)?\s*[:=]/i.test(src), `${f} must not write offers or fares`);
    }
  });
});

describe("draftFromAi: every value the AI returns is re-checked", () => {
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
    const { draft, questions } = draftFromAi(good, TODAY);
    assert.deepEqual(draft, {
      origin: "DXB", destination: "LON", departOn: "2027-01-15", returnOn: "2027-01-29", adults: "2", children: "1", infants: "0",
      cabin: "Business", preferredAirlines: "EK, QR", budgetAmount: "9000", budgetCurrency: "USD",
    });
    assert.deepEqual(questions, []);
  });

  it("turns missing or invalid values into blanks plus questions, never guesses", () => {
    const { draft, questions } = draftFromAi({ ...good, origin: null, destination: "LONDON", depart_on: "2025-01-01", return_on: "2027-01-10", adults: 0, infants: 3, cabin: "Luxury" }, TODAY);
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
    assert.equal(draftFromAi({ ...good, return_on: "2027-01-10" }, TODAY).draft.returnOn, "");
    assert.equal(draftFromAi({ ...good, destination: "DXB" }, TODAY).draft.destination, "");
    assert.equal(draftFromAi({ ...good, depart_on: "2027-02-30" }, TODAY).draft.departOn, "");
  });

  it("passes on the AI's own questions (trimmed, at most 8) and never throws on garbage", () => {
    assert.deepEqual(draftFromAi({ ...good, questions: ["  Which London airport? "] }, TODAY).questions, ["Which London airport?"]);
    for (const junk of [null, undefined, "text", 42, [], { adults: "two" }]) {
      const { draft } = draftFromAi(junk, TODAY);
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
  it("the saved row is a search request, marked not searched, linked to the AI reading", () => {
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

  it("every reading is logged before the AI is asked (so the database limit and checks apply first)", () => {
    const a = read("src/lib/actions/flight-requests.ts");
    const fn = a.slice(a.indexOf("export async function readFlightRequest"), a.indexOf("export async function saveFlightRequest"));
    const order = ["requestTextProblem(text, linked.names)", "if (!aiConfigured())", '.from("ai_actions")\n    .insert(', "readFlightRequestWithAi(", 'status: "Failed"'];
    let at = -1;
    for (const s of order) { const n = fn.indexOf(s, at + 1); assert.ok(n > at, s); at = n; }
    assert.match(fn, /action_kind: "Flight request",\s*status: "Proposed",/);
  });

  it("the panel only saves after the review box is ticked, and shows no fares", () => {
    const ui = read("src/components/flights/FlightRequestPanel.tsx");
    assert.match(ui, /if \(Object\.keys\(errors\)\.length \|\| !reviewed\) return;/);
    assert.match(ui, /saveFlightRequest\(reading\.actionId, draft, link, reviewed\)/);
    assert.match(ui, /Don&apos;t include names, phone numbers, e-mail addresses, passport or other ID numbers/);
    assert.match(ui, /It never shows fares or availability\./);
    assert.ok(!/formatMoney|\bfare\b(?! or| Not)/i.test(ui.replace(/never shows fares|no fares are shown/gi, "")), "no fare display");
  });
});

describe("when the AI service returns an error", () => {
  it("a refused request is 'rejected' (retrying won't help); timeouts, limits, server errors are 'unavailable'", () => {
    for (const s of [400, 401, 403, 404, 413, 422]) assert.equal(aiFailureReason(s), "rejected", String(s));
    for (const s of [408, 409, 429, 500, 502, 503, 529, undefined]) assert.equal(aiFailureReason(s), "unavailable", String(s));
  });

  it("logs Anthropic's explanation and request ID on one short line, with anything key-like masked", () => {
    assert.equal(
      aiErrorLog({ status: 400, type: "invalid_request_error", errorCode: null, requestID: "req_123", apiMessage: "Your credit balance is too low.\n Please add credit." }),
      'status=400 type=invalid_request_error code=none request_id=req_123 message="Your credit balance is too low. Please add credit."',
    );
    assert.equal(aiErrorLog({}), 'status=none type=none code=none request_id=none message=""');
    const fakeKey = "sk-ant-" + "x".repeat(24);
    assert.ok(!aiErrorLog({ status: 401, apiMessage: `bad key ${fakeKey}` }).includes(fakeKey));
    assert.ok(aiErrorLog({ apiMessage: "y".repeat(1000) }).length < 400);
  });

  it("agents see why: a rejection asks for the admin, an outage says try again", () => {
    const ai = read("src/lib/ai/flight-request-ai.ts");
    assert.match(ai, /return \{ ok: false, reason: aiFailureReason\(error\.status\) \};/);
    const actions = read("src/lib/actions/flight-requests.ts");
    assert.match(actions, /rejected: "The AI service rejected the request, so trying again won't help\. Ask your admin/);
    assert.match(actions, /unavailable: "The AI service didn't respond\. Try again in a moment/);
  });
});

describe("API key and model", () => {
  it("the key is read only on the server, from ANTHROPIC_API_KEY (never NEXT_PUBLIC_), and never logged", () => {
    const ai = read("src/lib/ai/flight-request-ai.ts");
    assert.match(ai, /process\.env\.ANTHROPIC_API_KEY/);
    assert.ok(!/NEXT_PUBLIC_ANTHROPIC|apiKey:/.test(ai), "no public variable, no key passed around");
    assert.match(ai, /if \(typeof window !== "undefined"\) throw new Error\("The AI client can only be used on the server\."\);/);
    assert.match(ai, /console\.error\("AI flight-request reading failed:", aiErrorLog\(error\)\);/);
    assert.ok(!/console\.\w+\([^)]*(process\.env|apiKey|headers)/.test(ai), "nothing key-bearing is logged");
    for (const f of ["src/components/flights/FlightRequestPanel.tsx", "src/lib/flight-request.ts"]) {
      assert.ok(!/@anthropic-ai\/sdk|ANTHROPIC_API_KEY/.test(read(f)), `${f} must not touch the SDK or key`);
    }
  });

  it("no API key is committed anywhere in the project's source", () => {
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : files.push(join(d, n))));
    for (const dir of ["src", "supabase/migrations", "scripts"]) walk(fileURLToPath(new URL(`../../${dir}`, import.meta.url)));
    for (const f of files) assert.ok(!/sk-ant-[A-Za-z0-9_-]{10,}/.test(readFileSync(f, "utf8")), f);
  });

  it("uses Claude Opus 5.5 at low effort, structured output, the default refusal fallback, a 30s timeout", () => {
    const ai = read("src/lib/ai/flight-request-ai.ts");
    assert.equal(AI_MODEL, "claude-opus-5-5");
    assert.match(ai, /model: AI_MODEL,/);
    assert.match(ai, /betas: \["server-side-fallback-2026-07-01"\],\s*fallbacks: "default",/);
    assert.match(ai, /output_config: \{ effort: "low", format: \{ type: "json_schema", schema: EXTRACTION_SCHEMA/);
    assert.match(ai, /new Anthropic\(\{ timeout: 30_000, maxRetries: 1 \}\)/);
    assert.match(ai, /if \(response\.stop_reason === "refusal"\)/);
  });

  it("the SDK version is pinned exactly", () => {
    assert.equal(JSON.parse(read("package.json")).dependencies["@anthropic-ai/sdk"], "1.8.0");
  });

  it("limit and cost estimate", () => {
    assert.equal(DAILY_LIMIT, 50);
    assert.ok(read("supabase/migrations/20261120002500_ai_flight_requests.sql").includes("daily_limit constant integer := 50;"));
    assert.equal(estimateCostUsd(1500, 300), 0.012);
  });
});
