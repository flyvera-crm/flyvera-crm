// Agency settings (src/lib/settings-rules.ts) and the rules that now take their values from settings.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUILT_IN_DEFAULTS,
  DEFAULT_TERMS,
  FALLBACK_SETTINGS,
  formFromSettings,
  formToDb,
  invoiceSource,
  letterhead,
  settingsFromRow,
  validateAgencyForm,
} from "@/lib/settings-rules";
import { bookingDates } from "@/lib/booking-rules";
import { supplierPayables } from "@/lib/payment-ledger";
import { emptyQuoteForm, freshValidity } from "@/lib/quote-validation";

const TODAY = "2026-11-24";
const validForm = () => {
  const f = formFromSettings(FALLBACK_SETTINGS);
  f.name = "FLYVERA TRAVEL";
  f.profile.email = "accounts@flyvera.test";
  f.profile.iban = "AE07 0331 2345 6789 0123 456";
  f.profile.swift = "ebiladax";
  return f;
};

describe("reading settings", () => {
  it("falls back to the built-in values when nothing is saved", () => {
    assert.deepEqual(settingsFromRow(null), FALLBACK_SETTINGS);
    const s = settingsFromRow({ name: "FLYVERA TRAVEL", base_currency: "USD", timezone: "UTC", settings: {} });
    assert.deepEqual(s.defaults, BUILT_IN_DEFAULTS);
    assert.equal(s.name, "FLYVERA TRAVEL");
    assert.equal(s.profile.address, "");
  });

  it("ignores invalid saved values, and invoices fall back to the quotation terms", () => {
    const s = settingsFromRow({
      name: "A",
      settings: { default_tax_rate: 99, quote_validity_days: "x", deposit_days: 2.5, low_margin_percent: 12, quote_terms: ["Only line", " ", 7] },
    });
    assert.equal(s.defaults.defaultTaxRate, 0, "out of range → default");
    assert.equal(s.defaults.quoteValidityDays, 14, "not a number → default");
    assert.equal(s.defaults.depositDays, 7, "days must be whole → default");
    assert.equal(s.defaults.lowMarginPercent, 12);
    assert.deepEqual(s.defaults.quoteTerms, ["Only line"]);
    assert.deepEqual(s.defaults.invoiceTerms, ["Only line"]);
  });

  it("uses the same default terms as the database (migration 20)", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261120002000_agency_settings.sql", import.meta.url), "utf8");
    for (const t of DEFAULT_TERMS) assert.ok(sql.includes(`"${t}"`), `migration 20 has: ${t}`);
  });
});

describe("the settings form", () => {
  it("accepts a valid form (optional fields may be empty)", () => {
    assert.deepEqual(validateAgencyForm(validForm()), {});
  });

  it("rejects values outside the database's limits", () => {
    const cases = [
      [(f) => (f.defaults.defaultTaxRate = "60"), "defaults.defaultTaxRate"],
      [(f) => (f.defaults.defaultTaxRate = "5.125"), "defaults.defaultTaxRate"],
      [(f) => (f.defaults.quoteValidityDays = "0"), "defaults.quoteValidityDays"],
      [(f) => (f.defaults.depositDays = "2.5"), "defaults.depositDays"],
      [(f) => (f.defaults.balanceDaysBeforeDeparture = ""), "defaults.balanceDaysBeforeDeparture"],
      [(f) => (f.defaults.quoteTerms = Array(11).fill("Line").join("\n")), "defaults.quoteTerms"],
      [(f) => (f.defaults.invoiceTerms = "x".repeat(301)), "defaults.invoiceTerms"],
      [(f) => (f.profile.email = "not-an-email"), "profile.email"],
      [(f) => (f.profile.swift = "ABC"), "profile.swift"],
      [(f) => (f.profile.iban = "12345"), "profile.iban"],
      [(f) => (f.profile.phone = "call me"), "profile.phone"],
      [(f) => (f.name = "F"), "name"],
    ];
    for (const [change, field] of cases) {
      const f = validForm();
      change(f);
      assert.ok(validateAgencyForm(f)[field], `${field} should be rejected`);
    }
  });

  it("sends trimmed text, numbers and terms without blank lines", () => {
    const f = validForm();
    f.name = "  FLYVERA TRAVEL ";
    f.profile.city = " Dubai ";
    f.defaults.defaultTaxRate = "5";
    f.defaults.quoteTerms = "First\n\n  Second  \n";
    const { name, profile, defaults } = formToDb(f);
    assert.equal(name, "FLYVERA TRAVEL");
    assert.equal(profile.city, "Dubai");
    assert.equal(profile.tax_number, "");
    assert.equal(defaults.default_tax_rate, 5);
    assert.equal(defaults.quote_validity_days, 14);
    assert.deepEqual(defaults.quote_terms, ["First", "Second"]);
  });
});

describe("documents", () => {
  it("prints only the details that are filled in", () => {
    const head = letterhead("FLYVERA TRAVEL", {
      legalName: "Flyvera Travel & Tourism LLC",
      address: "Office 1203",
      city: "Dubai",
      country: "",
      phone: "+971 4 555 0100",
      email: "",
      taxNumber: "100123456700003",
      iban: "AE07",
      paymentNote: "Quote the invoice number.",
    });
    assert.equal(head.legalName, "Flyvera Travel & Tourism LLC");
    assert.deepEqual(head.lines, ["Office 1203, Dubai", "+971 4 555 0100", "TRN 100123456700003"]);
    assert.deepEqual(head.bank, ["IBAN: AE07"]);
    assert.equal(head.paymentNote, "Quote the invoice number.");
    assert.deepEqual(letterhead("FLYVERA", { legalName: "FLYVERA" }).legalName, "", "not repeated when it's the same as the name");
    assert.deepEqual(letterhead("FLYVERA", {}).lines, []);
  });

  it("prints an issued invoice's frozen copy, and a draft's current details", () => {
    const current = settingsFromRow({ name: "New Name", settings: { profile: { address: "New office" }, invoice_terms: ["Current terms"] } });
    const frozen = invoiceSource({ name: "Old Name", address: "Old office", terms: ["Old terms"] }, current);
    assert.equal(frozen.name, "Old Name");
    assert.equal(frozen.profile.address, "Old office");
    assert.deepEqual(frozen.terms, ["Old terms"]);
    const draft = invoiceSource(undefined, current);
    assert.equal(draft.profile.address, "New office");
    assert.deepEqual(draft.terms, ["Current terms"]);
  });
});

describe("rules that use the settings", () => {
  it("dates new bookings with the agency's deposit and balance days", () => {
    assert.deepEqual(bookingDates({ departDate: "2027-02-01" }, TODAY, { depositDays: 5, balanceDaysBeforeDeparture: 45 }), {
      departOn: "2027-02-01",
      returnOn: undefined,
      depositDue: "2026-11-29",
      balanceDue: "2026-12-18",
    });
    // Built-in values when none are given (same as before Settings existed).
    assert.equal(bookingDates({ departDate: "2027-02-01" }, TODAY).depositDue, "2026-12-01");
    // The balance is never due before the deposit.
    assert.equal(bookingDates({ departDate: "2026-12-10" }, TODAY, { depositDays: 10, balanceDaysBeforeDeparture: 30 }).balanceDue, "2026-12-04");
  });

  it("schedules supplier payments with the agency's days before departure", () => {
    const b = {
      id: "FV-1",
      status: "Confirmed",
      departDate: "2027-01-31",
      services: [{ id: "s1", type: "Hotel", description: "Hotel", quantity: 1, unitPrice: 500, cost: 400 }],
      payments: [],
      discount: 0,
      taxRate: 0,
    };
    assert.equal(supplierPayables([b], 21)[0].dueDate, "2027-01-10");
    assert.equal(supplierPayables([b])[0].dueDate, "2027-01-17", "built-in 14 days");
  });

  it("starts new quotations with the agency's tax and validity", () => {
    const form = emptyQuoteForm(TODAY, { defaultTaxRate: 5, quoteValidityDays: 10 });
    assert.equal(form.taxRate, "5");
    assert.equal(form.validUntil, "2026-12-04");
    assert.equal(freshValidity(TODAY, 30), "2026-12-24");
    assert.equal(emptyQuoteForm(TODAY).validUntil, "2026-12-08", "built-in 14 days");
  });
});
