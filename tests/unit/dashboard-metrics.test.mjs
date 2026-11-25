// Dashboard calculations (src/lib/dashboard-metrics.ts) and the customer CSV export.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  conversionRate,
  dashboardKpis,
  destinationsThisMonth,
  followUpsDue,
  leadPipeline,
  mentionsMoney,
  monthToDate,
  percentChange,
  revenueSeries,
  upcomingDepartures,
} from "@/lib/dashboard-metrics";
import { customersCsv, safeCell } from "@/lib/customer-export";
import { bookings as demoBookings } from "@/lib/mock-bookings";
import { leads as demoLeads } from "@/lib/mock-leads";

const TODAY = "2026-11-24";

/** A booking with one service line; `total` = unit price (no tax, no discount). */
function booking(id, { total = 1000, cost = 800, status = "Confirmed", created = "2026-11-03", depart = "2026-12-20", destination = "Paris, France", payments = [] } = {}) {
  return {
    id,
    dbId: `db-${id}`,
    customerId: "CU-1",
    customerName: `Customer ${id}`,
    customerPhone: "+971500000000",
    title: "Trip",
    destination,
    departDate: depart,
    adults: 2,
    children: 0,
    services: [{ id: "s1", type: "Flight", description: "Flight", quantity: 1, unitPrice: total, cost }],
    discount: 0,
    taxRate: 0,
    status,
    payments,
    depositDue: created,
    balanceDue: depart,
    agent: "Sara K.",
    created,
    updated: created,
    history: [],
  };
}
const pay = (id, date, amount, kind = "payment") => ({ id, date, amount, method: "Card", kind });

function lead(id, { stage = "New", created = "2026-11-01", next, budget = 1000 } = {}) {
  return {
    id,
    name: `Lead ${id}`,
    phone: "+971500000000",
    source: "WhatsApp",
    stage,
    priority: "Warm",
    destination: "Bali",
    tripType: "Holiday",
    travellers: 2,
    budget,
    agent: "Sara K.",
    created,
    lastContact: created,
    nextFollowUp: next,
  };
}

// A: this month, $400 received. B: last month, $500 received then $100 refunded this month. C: cancelled.
const A = booking("FV-1", { total: 1000, created: "2026-11-03", payments: [pay("p1", "2026-11-05", 400)] });
const B = booking("FV-2", { total: 500, created: "2026-10-10", payments: [pay("p1", "2026-10-12", 500), pay("r1", "2026-11-10", 100, "refund")] });
const C = booking("FV-3", { total: 700, created: "2026-11-04", status: "Cancelled" });
const BOOKINGS = [A, B, C];

describe("periods", () => {
  it("compares the month so far with the same days of last month", () => {
    assert.deepEqual(monthToDate("2026-11-24"), { current: { from: "2026-11-01", to: "2026-11-24" }, previous: { from: "2026-10-01", to: "2026-10-24" } });
    assert.deepEqual(monthToDate("2026-03-31").previous, { from: "2026-02-01", to: "2026-02-28" }, "capped at a shorter month's end");
    assert.deepEqual(monthToDate("2026-01-15").previous, { from: "2025-12-01", to: "2025-12-15" }, "January compares with December");
  });

  it("gives no % change when there's nothing to compare with", () => {
    assert.equal(percentChange(150, 100), 50);
    assert.equal(percentChange(50, 100), -50);
    assert.equal(percentChange(10, 0), null);
  });
});

describe("headline cards", () => {
  it("counts money actually received (payments minus refunds) by payment date", () => {
    const [received, booked, created] = dashboardKpis(BOOKINGS, [], TODAY, { money: true, leads: false });
    assert.equal(received.label, "Money received this month");
    assert.equal(received.value, 300, "400 received − 100 refunded this month");
    assert.equal(received.delta, -40, "vs 500 in the same days of October");
    assert.equal(booked.value, 1000, "cancelled bookings don't count as booked value");
    assert.equal(booked.delta, 100);
    assert.equal(created.value, 1, "one live booking created this month");
    assert.equal(received.trend.length, 6);
  });

  it("shows each role only the cards it may see", () => {
    const labels = (access) => dashboardKpis(BOOKINGS, [lead("LD-1")], TODAY, access).map((k) => k.label);
    assert.deepEqual(labels({ money: true, leads: true }), ["Money received this month", "Booked value this month", "New bookings this month", "Lead conversion (90 days)"]);
    assert.deepEqual(labels({ money: false, leads: true }), ["New bookings this month", "Lead conversion (90 days)", "Open leads", "Follow-ups due"], "support: no money");
    assert.deepEqual(labels({ money: true, leads: false }), ["Money received this month", "Booked value this month", "New bookings this month", "Still to collect"], "finance / ticketing: no leads");
    const support = dashboardKpis(BOOKINGS, [lead("LD-1")], TODAY, { money: false, leads: true });
    assert.ok(support.every((k) => k.format !== "currency"), "no money figures for support");
  });

  it("works out what is still to collect on active bookings", () => {
    const card = dashboardKpis(BOOKINGS, [], TODAY, { money: true, leads: false })[3];
    assert.equal(card.value, 700, "A owes 600 and B owes 100; the cancelled booking owes nothing");
  });

  it("produces finite numbers for the demo data", () => {
    const cards = dashboardKpis(demoBookings, demoLeads, "2026-11-20", { money: true, leads: true });
    assert.equal(cards.length, 4);
    assert.ok(cards.every((k) => Number.isFinite(k.value)));
  });
});

describe("leads", () => {
  const leads = [
    lead("LD-1", { next: "2026-11-20" }), // overdue
    lead("LD-2", { next: TODAY, stage: "Quoted" }), // due today
    lead("LD-3", { next: "2026-11-25" }), // future
    lead("LD-4", { next: "2026-11-01", stage: "Won" }), // closed
    lead("LD-5", { stage: "Contacted" }), // no date
  ];

  it("lists open follow-ups due today or overdue, most overdue first", () => {
    assert.deepEqual(followUpsDue(leads, TODAY).map((l) => l.id), ["LD-1", "LD-2"]);
  });

  it("measures conversion as won ÷ closed for leads created in the period", () => {
    const cohort = [
      lead("W1", { stage: "Won", created: "2026-10-01" }),
      lead("W2", { stage: "Won", created: "2026-10-02" }),
      lead("W3", { stage: "Won", created: "2026-10-03" }),
      lead("L1", { stage: "Lost", created: "2026-10-04" }),
      lead("O1", { stage: "New", created: "2026-10-05" }),
      lead("OLD", { stage: "Lost", created: "2025-01-01" }),
    ];
    assert.equal(conversionRate(cohort, { from: "2026-09-01", to: TODAY }), 75);
    assert.equal(conversionRate([lead("O2")], { from: "2026-09-01", to: TODAY }), null, "nothing closed yet");
  });

  it("builds the pipeline by stage with estimated value", () => {
    const p = leadPipeline([lead("a", { budget: 1000 }), lead("b", { budget: 500 }), lead("c", { stage: "Won", budget: 2000 }), lead("d", { stage: "Lost" })]);
    assert.deepEqual(p.map((s) => s.stage), ["New", "Contacted", "Quoted", "Negotiation", "Won"]);
    assert.deepEqual(p[0], { stage: "New", count: 2, value: 1500 });
    assert.deepEqual(p[4], { stage: "Won", count: 1, value: 2000 });
  });
});

describe("charts and lists", () => {
  it("gives 12 months of net money received", () => {
    const series = revenueSeries(BOOKINGS, TODAY, 12);
    assert.equal(series.length, 12);
    assert.deepEqual(series.at(-1), { month: "Nov", revenue: 300 });
    assert.deepEqual(series.at(-2), { month: "Oct", revenue: 500 });
  });

  it("ranks this month's destinations by bookings, without cancelled ones", () => {
    const list = destinationsThisMonth(
      [A, booking("FV-4", { created: "2026-11-10" }), booking("FV-5", { created: "2026-11-11", destination: "Bali, Indonesia" }), C, B],
      TODAY,
    );
    assert.deepEqual(list, [{ label: "Paris", value: 2 }, { label: "Bali", value: 1 }]);
  });

  it("lists departures in the next 7 days: recorded flights, then trips without flights", () => {
    const soon = booking("FV-10", { depart: "2026-11-26" });
    const trip = booking("FV-11", { depart: "2026-11-25", destination: "Rome, Italy" });
    const cancelled = booking("FV-12", { depart: "2026-11-25", status: "Cancelled" });
    const later = booking("FV-13", { depart: "2026-12-15" });
    const seg = (b, departsAt, status = "Confirmed") => ({ bookingDbId: b.dbId, flight: "QR 15", from: "DOH", to: "CDG", departsAt, status });
    const list = upcomingDepartures(
      [seg(soon, "2026-11-26T08:30"), seg(soon, "2026-12-02T09:00", "Cancelled"), seg(cancelled, "2026-11-25T10:00"), seg(later, "2026-12-15T10:00")],
      [soon, trip, cancelled, later],
      TODAY,
      7,
    );
    assert.deepEqual(
      list.map((d) => [d.kind, d.booking.id, d.date]),
      [
        ["trip", "FV-11", "2026-11-25"],
        ["flight", "FV-10", "2026-11-26"],
      ],
    );
  });
});

describe("activity feed", () => {
  it("spots timeline lines that mention money (hidden from roles without money access)", () => {
    assert.equal(mentionsMoney("Payment of $500 recorded"), true);
    assert.equal(mentionsMoney("Refund RF-10477-1 of USD 120.00 requested (Cancellation)"), true);
    assert.equal(mentionsMoney("Booking confirmed"), false);
    assert.equal(mentionsMoney("Ticket 157-2345678901 issued for Amelia Clarke"), false);
    assert.equal(mentionsMoney("FV-10481 moved to Ticketed"), false);
  });
});

describe("customer CSV export", () => {
  it("keeps formulas and phone numbers as text", () => {
    assert.equal(safeCell("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")");
    assert.equal(safeCell("+971501234567"), "'+971501234567");
    assert.equal(safeCell("@cmd"), "'@cmd");
    assert.equal(safeCell("Amelia"), "Amelia");
    assert.equal(safeCell(42), 42);
  });

  it("exports contact details only, blanking figures the user can't see", () => {
    const base = { email: "a@b.test", phone: "+971500000001", city: "Dubai", country: "UAE", tier: "Gold", status: "Active", trips: 3, lifetimeValue: 1234.5, lastTrip: "2026-05-01", favouriteDestination: "Paris", agent: "Sara K.", joined: "2025-01-01", passportNumber: "X1234567", notes: "VIP, likes window" };
    const csv = customersCsv([
      { ...base, id: "CU-1002", name: "Smith, John" },
      { ...base, id: "CU-1001", name: "=1+1", statsHidden: true },
    ]);
    const lines = csv.split("\r\n");
    assert.equal(lines[0], "Customer,Name,Email,Phone,City,Country,Tier,Status,Trips,Lifetime value,Last trip,Assigned to,Joined");
    assert.equal(lines[1], "CU-1001,'=1+1,a@b.test,'+971500000001,Dubai,UAE,Gold,Active,,,,Sara K.,2025-01-01");
    assert.equal(lines[2], 'CU-1002,"Smith, John",a@b.test,\'+971500000001,Dubai,UAE,Gold,Active,3,1234.5,2026-05-01,Sara K.,2025-01-01');
    assert.ok(!csv.includes("X1234567") && !csv.includes("VIP"), "no passport numbers or notes");
  });
});
