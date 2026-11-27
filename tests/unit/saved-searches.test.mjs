// Saved searches on the Flights page: the pure row → display mapping, and the read-only, RLS-scoped loading.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyDraft, searchRow } from "@/lib/flight-request";
import { passengersText, savedSearchFromRow } from "@/lib/saved-searches";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** A flight_searches row exactly as the save action writes it. */
function saved(draft, extra = {}) {
  const row = searchRow({ ...emptyDraft, ...draft }, "11111111-1111-1111-1111-111111111111", ["Which London airport?"]);
  return { id: "s1", searched_at: "2026-11-27T20:00:00Z", created_by: "u1", lead_id: null, customer_id: null, ...row, ...extra };
}

describe("savedSearchFromRow: what the list shows", () => {
  it("shows a saved return search with every preference the agent approved", () => {
    const row = saved({
      tripType: "Return", origin: "DXB", destination: "LHR", departOn: "2027-01-15", returnOn: "2027-01-29", adults: "2", children: "1",
      infants: "0", cabin: "Business", flexibleDays: "2", stops: "Direct only", departTime: "Evening", returnTime: "Morning",
      preferredAirlines: "EK, BA", baggage: "Checked bags", checkedBags: "2", baggageNote: "2 × 23 kg", fareRules: "Refundable",
      budgetAmount: "9000", budgetCurrency: "USD", notes: "Window seat",
    });
    const s = savedSearchFromRow(row, {
      names: new Map([["u1", "Sara Khan"]]),
      typed: new Map([["11111111-1111-1111-1111-111111111111", "2 adults 1 child DXB-LHR 15 Jan back 29 Jan"]]),
    });
    assert.equal(s.tripType, "Return");
    assert.deepEqual(s.flights, [{ origin: "DXB", destination: "LHR", departOn: "2027-01-15" }]);
    assert.equal(s.returnOn, "2027-01-29");
    assert.equal(s.flexibleDays, 2);
    assert.equal(s.passengers, "2 adults, 1 child");
    assert.equal(s.savedBy, "Sara Khan");
    assert.equal(s.typedRequest, "2 adults 1 child DXB-LHR 15 Jan back 29 Jan");
    assert.deepEqual(s.details, [
      { label: "Stops", value: "Direct only" },
      { label: "Departure time", value: "Evening" },
      { label: "Return time", value: "Morning" },
      { label: "Preferred airlines", value: "EK, BA" },
      { label: "Baggage requested", value: "2 checked bags, 2 × 23 kg" },
      { label: "Fare conditions requested", value: "Refundable" },
      { label: "Budget (agent's figure)", value: "USD 9,000" },
    ]);
    assert.deepEqual(s.notes, ["Window seat"]);
    assert.deepEqual(s.openQuestions, ["Which London airport?"]);
    assert.equal(s.searched, false);
    assert.equal(s.link, null);
  });

  it("shows every flight of a multi-city search, in order", () => {
    const s = savedSearchFromRow(saved({
      tripType: "Multi-city", origin: "DXB", destination: "LHR", departOn: "2027-01-15", adults: "1",
      legs: [{ origin: "LHR", destination: "CDG", departOn: "2027-01-20" }, { origin: "CDG", destination: "DXB", departOn: "2027-01-27" }],
    }));
    assert.equal(s.tripType, "Multi-city");
    assert.deepEqual(s.flights.map((f) => `${f.origin}-${f.destination} ${f.departOn}`), ["DXB-LHR 2027-01-15", "LHR-CDG 2027-01-20", "CDG-DXB 2027-01-27"]);
    assert.equal(s.returnOn, null);
  });

  it("shows the linked lead or customer, or says it can't be viewed", () => {
    const row = saved({ origin: "DXB", destination: "LHR", departOn: "2027-01-15" });
    assert.deepEqual(savedSearchFromRow({ ...row, lead_id: "l1" }, { lead: { code: "LD-2001", name: "Omar Haddad" } }).link, { kind: "lead", code: "LD-2001", name: "Omar Haddad" });
    assert.deepEqual(savedSearchFromRow({ ...row, customer_id: "c1" }, { customer: { code: "CU-1001", name: "Amelie Hartley" } }).link, { kind: "customer", code: "CU-1001", name: "Amelie Hartley" });
    assert.deepEqual(savedSearchFromRow({ ...row, customer_id: "c1" }).link, { kind: "hidden" }, "linked, but this person may not read it");
  });

  it("copes with searches saved by earlier versions, or with odd data, without inventing anything", () => {
    const base = { id: "s0", origin: "DXB", destination: "LHR", depart_on: "2027-01-15", return_on: null, adults: 1, children: 0, infants: 0, cabin: "Economy", searched_at: "2026-11-20T10:00:00Z", created_by: null, lead_id: null, customer_id: null };
    for (const request of [null, "text", [], { source: "AI reading, reviewed and approved by the agent", preferred_airlines: ["EK"], budget: null, open_questions: [], searched: false }]) {
      const s = savedSearchFromRow({ ...base, request });
      assert.equal(s.tripType, "One-way");
      assert.equal(s.savedBy, "Unknown");
      assert.equal(s.typedRequest, null);
    }
    const odd = savedSearchFromRow({
      ...base,
      request: {
        further_legs: [{ origin: "lhr", destination: "CDG", depart_on: "2027-01-20" }, "x"],
        stops: "Teleport", via: ["DOH", "<script>", 5], max_connection_hours: 99, flexible_days: 30,
        baggage_requested: { need: "Checked bags", checked_bags: 50 }, budget: { amount: -5, currency: "USD" },
        notes: ["ok", "\u0007bell", 7], searched: "yes",
      },
    });
    assert.deepEqual(odd.flights.length, 1, "badly formed further flights are left out");
    assert.deepEqual(odd.details, [{ label: "Connect via", value: "DOH" }, { label: "Baggage requested", value: "Checked bags" }]);
    assert.equal(odd.flexibleDays, null);
    assert.deepEqual(odd.notes, ["ok", "bell"]);
    assert.equal(odd.searched, false);
  });

  it("writes passenger counts in words", () => {
    assert.equal(passengersText(1, 0, 0), "1 adult");
    assert.equal(passengersText(2, 2, 1), "2 adults, 2 children, 1 infant");
  });
});

describe("loading: read-only, as the signed-in user", () => {
  const loader = read("src/lib/data/flight-searches.ts");

  it("uses the user's own session (Row Level Security), never the service role, and only reads", () => {
    assert.match(loader, /import \{ createClient \} from "@\/lib\/supabase\/server";/);
    assert.ok(!/service|admin\/|SERVICE_ROLE|createAdminClient/i.test(loader.replace(/^\/\/.*$/gm, "")), "no service-role client");
    assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(loader), "nothing is written");
    assert.match(loader, /\.from\("flight_searches"\)[\s\S]*?\.eq\("organization_id", m\.organizationId\)[\s\S]*?\.order\("searched_at", \{ ascending: false \}\)[\s\S]*?\.limit\(SAVED_SEARCH_LIMIT \+ 1\)/);
  });

  it("is shown to the roles that may create flight searches; others get nothing", () => {
    assert.match(loader, /const VIEW: AppRole\[\] = \["admin", "sales_manager", "sales_agent", "ticketing_agent"\];/);
    assert.match(loader, /if \(!m \|\| !VIEW\.includes\(m\.role\)\) return \{ allowed: false, searches: \[\], more: false \};/);
  });

  it("the Flights page lists them below the request panel, and saving refreshes the page", () => {
    const page = read("src/app/(crm)/flights/page.tsx");
    assert.match(page, /\{saved\.allowed && <SavedSearches searches=\{saved\.searches\} more=\{saved\.more\} limit=\{SAVED_SEARCH_LIMIT\} \/>\}/);
    assert.ok(page.indexOf("<FlightRequestPanel") < page.indexOf("<SavedSearches"));
    assert.match(read("src/lib/actions/flight-requests.ts"), /flight_search_id: search\.id[\s\S]*?refresh\(\);/);
  });

  it("the list shows no fares, availability, PNRs or ticket numbers", () => {
    const ui = read("src/components/flights/SavedSearches.tsx");
    assert.ok(!/formatMoney|formatCurrency|flight_offers|pnr|ticket_?number/i.test(ui.replace(/^\/\/.*$/gm, "")));
    assert.match(ui, /Not searched: no fares or availability\./);
    assert.match(ui, /Baggage and fare conditions are the customer&apos;s requests, not confirmed allowances or rules\./);
  });
});
