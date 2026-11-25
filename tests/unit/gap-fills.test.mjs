// Gap fills: spreadsheet-safe CSV (incl. Reports), payments & invoices exports, supplier filter and form,
// lead activity rules, and the money-mention rule shared with the database (migration 21).
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bookingsCsv, safeCell, toCsv } from "@/lib/report-metrics";
import { filterBySupplier, invoicesCsv, payableSuppliers, paymentsCsv } from "@/lib/exports";
import { supplierRow, validateSupplier, emptySupplierForm } from "@/lib/supplier-rules";
import { describeActivity, validateActivity } from "@/lib/lead-activity-rules";
import { mentionsMoney } from "@/lib/dashboard-metrics";

const lines = (csv) => csv.split("\r\n");

describe("spreadsheet-safe CSV (every export, Reports included)", () => {
  it("keeps formulas and +phone numbers as text, but leaves dates and numbers alone", () => {
    assert.equal(safeCell("=SUM(A1:A9)"), "'=SUM(A1:A9)");
    assert.equal(safeCell("+971501234567"), "'+971501234567");
    assert.equal(safeCell("-cmd"), "'-cmd");
    assert.equal(safeCell("@x"), "'@x");
    assert.equal(safeCell("2026-11-24"), "2026-11-24", "dates aren't touched");
    assert.equal(safeCell("FV-10481"), "FV-10481");
    assert.equal(safeCell(-120.5), -120.5, "numbers (even negative) stay numbers");
    assert.equal(lines(toCsv([["=1+1", "a,b", 'say "hi"', -3]]))[0], `'=1+1,"a,b","say ""hi""",-3`);
  });

  it("protects the Reports bookings export too", () => {
    const b = {
      id: "FV-1", created: "2026-11-02", customerName: "=HYPERLINK(\"x\")", destination: "Paris, France", departDate: "2026-12-01",
      status: "Confirmed", agent: "Sara K.", services: [{ quantity: 1, unitPrice: 100, cost: 80 }], discount: 0, taxRate: 0, payments: [],
    };
    const row = lines(bookingsCsv([b], { from: "2026-11-01", to: "2026-11-30" }))[1];
    assert.ok(row.startsWith(`FV-1,2026-11-02,"'=HYPERLINK(""x"")"`), row);
  });
});

describe("payments and invoices exports", () => {
  const booking = { id: "FV-7", customerName: "Amelia Clarke" };
  it("exports payments and refunds with signed amounts", () => {
    const csv = paymentsCsv([
      { booking, receiptNo: "RC-7-1", signedAmount: 500, payment: { id: "p1", date: "2026-11-02", amount: 500, method: "Card", reference: "AUTH-9", note: "Deposit" } },
      { booking, receiptNo: "RF-7-1", signedAmount: -100, payment: { id: "r1", date: "2026-11-10", amount: 100, method: "Bank transfer", kind: "refund" } },
    ]);
    assert.deepEqual(lines(csv), [
      "Date,Receipt,Type,Booking,Customer,Method,Amount,Reference,Note",
      "2026-11-02,RC-7-1,Payment,FV-7,Amelia Clarke,Card,500,AUTH-9,Deposit",
      "2026-11-10,RF-7-1,Refund,FV-7,Amelia Clarke,Bank transfer,-100,,",
    ]);
  });

  it("exports invoices with balances (blank for drafts and void invoices)", () => {
    const inv = (over) => ({ number: "INV-2026-0001", issueOn: "2026-11-01", dueOn: "2026-11-15", billTo: { name: "Amelia Clarke" }, customerCode: "CU-1001", bookingCode: "FV-7", currency: "USD", total: 1000, paid: 400, ...over });
    const csv = invoicesCsv([
      { inv: inv({}), status: "Partially paid", balance: 600 },
      { inv: inv({ number: undefined, issueOn: undefined }), status: "Draft", balance: 1000 },
      { inv: inv({ number: "INV-2026-0002" }), status: "Void", balance: 0 },
    ]);
    assert.deepEqual(lines(csv).slice(1), [
      "INV-2026-0001,Partially paid,2026-11-01,2026-11-15,Amelia Clarke,CU-1001,FV-7,USD,1000,400,600",
      "Draft,Draft,,2026-11-15,Amelia Clarke,CU-1001,FV-7,USD,1000,,",
      "INV-2026-0002,Void,2026-11-01,2026-11-15,Amelia Clarke,CU-1001,FV-7,USD,1000,,",
    ]);
  });
});

describe("suppliers", () => {
  const p = (id, supplierId, supplierName) => ({ booking: { id }, service: { id: "s1", supplierId, supplierName, cost: 100 }, dueDate: "2026-12-01" });
  const payables = [p("FV-1", "a", "Qatar Airways"), p("FV-2", "b", "Atlantis Hotel"), p("FV-3"), p("FV-4", "a", "Qatar Airways")];

  it("filters supplier payments by supplier, or by 'not linked yet'", () => {
    assert.equal(filterBySupplier(payables, "").length, 4);
    assert.deepEqual(filterBySupplier(payables, "a").map((x) => x.booking.id), ["FV-1", "FV-4"]);
    assert.deepEqual(filterBySupplier(payables, "none").map((x) => x.booking.id), ["FV-3"]);
    assert.deepEqual(payableSuppliers(payables), [{ id: "b", name: "Atlantis Hotel" }, { id: "a", name: "Qatar Airways" }]);
  });

  it("validates the supplier form like the database", () => {
    const ok = { ...emptySupplierForm(), name: "Qatar Airways", type: "Airline", iataCode: "qr", email: "Res@Qatar.test", paymentTermsDays: "7" };
    assert.deepEqual(validateSupplier(ok), {});
    assert.deepEqual(supplierRow(ok), { name: "Qatar Airways", supplier_type: "Airline", iata_code: "QR", email: "res@qatar.test", phone: null, payment_terms_days: 7, notes: null });
    assert.ok(validateSupplier({ ...ok, type: "Hotel" }).iataCode, "IATA codes only for airlines");
    assert.ok(validateSupplier({ ...ok, iataCode: "QRX" }).iataCode);
    assert.ok(validateSupplier({ ...ok, paymentTermsDays: "400" }).paymentTermsDays);
    assert.ok(validateSupplier({ ...ok, name: "Q" }).name);
    assert.ok(validateSupplier({ ...ok, type: "" }).type);
  });
});

describe("lead activity", () => {
  it("needs a type and a short note; the next follow-up can't be in the past", () => {
    assert.deepEqual(validateActivity({ type: "Call", body: "Discussed villas", nextFollowUp: "2026-11-30" }, "2026-11-24"), {});
    assert.ok(validateActivity({ type: "", body: "Hi there", nextFollowUp: "" }, "2026-11-24").type);
    assert.ok(validateActivity({ type: "Note", body: " ", nextFollowUp: "" }, "2026-11-24").body);
    assert.ok(validateActivity({ type: "Call", body: "Called", nextFollowUp: "2026-11-01" }, "2026-11-24").nextFollowUp);
  });

  it("describes stage changes recorded by the database", () => {
    assert.equal(describeActivity({ type: "Stage change", fromStage: "New", toStage: "Contacted" }), "Moved from New to Contacted");
    assert.equal(describeActivity({ type: "Stage change", fromStage: "Quoted", toStage: "Lost", body: "Chose another agency" }), "Moved from Quoted to Lost — Chose another agency");
    assert.equal(describeActivity({ type: "Call", body: "Left a message" }), "Left a message");
  });
});

describe("money in timeline lines (same rule as the database)", () => {
  it("matches the samples the database test checks, and the migration uses the same patterns", () => {
    const samples = {
      "Payment of $500 recorded": true,
      "Refund RF-10477-1 of USD 120.00 requested (Cancellation)": true,
      "Invoice INV-2026-0001 issued (USD 1250.00, due 2026-12-01)": true,
      "Booking confirmed": false,
      "Ticket 157-2345678901 issued for Amelia Clarke": false,
      "FV-10481 moved to Ticketed": false,
    };
    for (const [text, expected] of Object.entries(samples)) assert.equal(mentionsMoney(text), expected, text);
    const sql = readFileSync(new URL("../../supabase/migrations/20261120002100_gap_fills.sql", import.meta.url), "utf8");
    assert.ok(sql.includes("(USD|EUR|GBP|AED|SAR|QAR)") && sql.includes("[$€£]") && sql.includes("[0-9]{2}"), "same currencies and amount pattern");
  });
});
