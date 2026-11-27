// Phase 2: supplier-safe flight data and ticket number source (database side: supabase/tests section 25).
// Fares, availability and ticket numbers are never invented: offers only from a connected supplier,
// no demo/sample supplier, and staff-recorded ticket numbers are marked "Manual from supplier document".
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectedSuppliers, liveSearchAvailable, PLACEHOLDER_SUPPLIER_NAMES, supplierOfferProblems } from "@/lib/flight-suppliers";
import { SUPPLIER_REFERENCE_RE, validateTicket } from "@/lib/ticketing-rules";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20261120002400_supplier_safe_flights.sql");

const offer = (over = {}) => ({
  supplier: "Amadeus",
  supplierOfferId: "AMA-1-ABC",
  fetchedAt: "2026-11-27T10:00:00Z",
  baseAmount: 410,
  taxAmount: 95.5,
  currency: "USD",
  validatingCarrier: "EK",
  segments: [{ carrier: "EK", flightNumber: "1", origin: "DXB", destination: "LHR", departsAt: "2027-01-10T07:45:00Z", arrivesAt: "2027-01-10T11:40:00Z" }],
  ...over,
});
const AMADEUS = [{ name: "Amadeus" }];

describe("no live supplier is connected, and none is faked", () => {
  it("the registry is empty, so live search is unavailable", () => {
    assert.deepEqual([...connectedSuppliers()], []);
    assert.equal(liveSearchAvailable(), false);
  });

  it("the registry contains no demo, sample or mock supplier", () => {
    const src = read("src/lib/flight-suppliers.ts");
    assert.match(src, /const CONNECTED_SUPPLIERS: readonly FlightSupplier\[\] = \[\];/);
    assert.ok(!/class \w*(Demo|Mock|Sample|Fake)\w*Supplier|name: "(Demo|Mock|Sample|Fake)/i.test(src));
  });

  it("the Flights page shows 'not connected' and has no search form or results", () => {
    const page = read("src/app/(crm)/flights/page.tsx");
    const ui = read("src/components/flights/FlightSupplierStatus.tsx");
    assert.match(page, /<FlightSupplierStatus suppliers=\{connectedSuppliers\(\)\.map/);
    assert.ok(!page.includes("ModulePlaceholder"));
    assert.match(ui, /No live flight supplier is connected/);
    assert.ok(!/<form|<input|<select|onSubmit|\$\d|USD \d|fare: \d/i.test(ui), "no search form, prices or results");
  });

  it("the app never writes flight offers itself (only a supplier connection may, migration 24)", () => {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(fileURLToPath(new URL("../../src", import.meta.url)));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/from\(\s*["']flight_offers["']\s*\)\s*\.(insert|update|upsert|delete)/.test(src), `${f} writes flight_offers`);
    }
  });

  it("the Flights menu item is shown (not planned) and promises no live fares", () => {
    const line = read("src/config/navigation.ts").match(/\{ label: "Flights", href: "\/flights",[^}]*\}/)?.[0];
    assert.ok(line, "Flights menu item exists");
    assert.doesNotMatch(line, /planned: true/);
    assert.match(line, /No live fares until a supplier is connected/);
  });
});

describe("supplierOfferProblems: an offer must come, complete, from a connected supplier", () => {
  it("accepts a complete offer from a connected supplier", () => {
    assert.deepEqual(supplierOfferProblems(offer(), AMADEUS), []);
  });

  it("refuses offers while no supplier is connected (today)", () => {
    assert.deepEqual(supplierOfferProblems(offer()), ["Supplier Amadeus isn't connected."]);
  });

  it("refuses placeholder suppliers — the same names the database refuses", () => {
    for (const name of ["Manual", "demo", " Sample ", "TEST", "Mock", "fake", ""]) {
      assert.ok(supplierOfferProblems(offer({ supplier: name }), [{ name }]).includes("Offer has no real supplier."), name);
    }
    const dbList = migration.match(/not in \(([^)]*)\)\)/)[1].replace(/['\s]/g, "").split(",");
    assert.deepEqual([...PLACEHOLDER_SUPPLIER_NAMES].sort(), dbList.sort());
  });

  it("refuses an offer missing the supplier's ID, fetch time, fare, currency or flights", () => {
    const cases = [
      [{ supplierOfferId: " " }, "Offer has no supplier offer ID."],
      [{ fetchedAt: "yesterday" }, "Offer has no fetch time."],
      [{ baseAmount: -1 }, "Offer has no valid fare."],
      [{ taxAmount: Number.NaN }, "Offer has no valid fare."],
      [{ currency: "usd" }, "Offer has no valid currency."],
      [{ validatingCarrier: "EMIRATES" }, "Offer has an invalid validating carrier."],
      [{ segments: [] }, "Offer has no flights."],
      [{ segments: [{ carrier: "EK", origin: "DXB", destination: "LHR", departsAt: "x", arrivesAt: "y" }] }, "Offer has an incomplete flight."],
    ];
    for (const [over, problem] of cases) assert.ok(supplierOfferProblems(offer(over), AMADEUS).includes(problem), problem);
  });
});

describe("ticket number source and supplier reference", () => {
  const base = {
    passengerId: "p",
    pnrId: "r",
    ticketNumber: "176 2104810001",
    airline: "EK",
    baseFare: "500",
    taxes: "80",
    issuedOn: "2026-11-20",
    supplierReference: "",
    confirmed: true,
  };
  const check = (over) => validateTicket({ ...base, ...over }, "2026-11-27", "2026-11-01");

  it("the supplier reference is optional and uses the database's pattern", () => {
    assert.deepEqual(check({}), {});
    assert.deepEqual(check({ supplierReference: "CNS-48213" }), {});
    assert.deepEqual(check({ supplierReference: "AB 12/34.5_6" }), {});
    for (const bad of ["ref;drop", "-dash", "x".repeat(61), "émoji✈"]) assert.equal(check({ supplierReference: bad }).supplierReference, "Up to 60 letters, digits, spaces and / . _ -", bad);
    assert.ok(migration.includes(`'${SUPPLIER_REFERENCE_RE.source}'`), "same regex as the database");
  });

  it("the agent must confirm the number was copied from the airline's or consolidator's e-ticket", () => {
    assert.equal(check({ confirmed: false }).confirmed, "Confirm you copied the number from the airline's or consolidator's e-ticket.");
  });

  it("the action sends the reference but never a source (the database sets it)", () => {
    const actions = read("src/lib/actions/ticketing.ts");
    const fn = actions.slice(actions.indexOf("export async function issueTicket"), actions.indexOf("export async function changeTicketStatus"));
    assert.match(fn, /supplierReference: str\(r, "supplierReference"\),/);
    assert.match(fn, /p_supplier_reference: v\.supplierReference\.trim\(\) \|\| null,/);
    assert.ok(!/number_source|Supplier API/.test(fn));
  });

  it("the dialog shows the fixed source, the optional reference and the e-ticket confirmation", () => {
    const modals = read("src/components/tickets/ticketing-modals.tsx");
    const m = modals.slice(modals.indexOf("export function IssueTicketModal"), modals.indexOf("export function TicketChangeModal"));
    assert.match(m, /<p className="mt-2 text-sm text-navy-600" data-testid="ticket-source">Manual from supplier document<\/p>/);
    assert.match(m, /<input id="tktSupplierRef" value=\{v\.supplierReference\} maxLength=\{60\}/);
    assert.match(m, /I copied this ticket number from the <span className="font-semibold">airline&apos;s or consolidator&apos;s e-ticket<\/span>/);
    assert.ok(!/<select[^>]*numberSource|Supplier API/.test(m), "staff can't choose the source");
  });

  it("tickets load and show their source and reference", () => {
    const data = read("src/lib/data/ticketing.ts");
    assert.match(data, /pnr_id, number_source, supplier_reference, /);
    assert.match(data, /numberSource: t\.number_source \?\? "Manual from supplier document",/);
    const panel = read("src/components/tickets/TicketingPanel.tsx");
    assert.match(panel, /\{t\.numberSource === "Supplier API" \? "from supplier connection" : "copied from supplier e-ticket"\}/);
  });
});
