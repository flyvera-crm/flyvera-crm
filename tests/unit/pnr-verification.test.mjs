// Phase 1: manual PNR verification in the app (the database side is tested in supabase/tests, section 24).
// Same rules as verify_pnr() (migration 23); separate from the PNR status and from tickets.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptyPnr,
  emptyVerification,
  PNR_STATUSES,
  PNR_VERIFICATION_STATUSES,
  resetsVerification,
  validatePnr,
  validateVerification,
  VERIFY_NOTES_MAX,
} from "@/lib/ticketing-rules";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20261120002300_pnr_verification.sql");

describe("verification values match the database", () => {
  it("the three statuses are the database enum, and separate from the PNR status", () => {
    assert.deepEqual(PNR_VERIFICATION_STATUSES, ["Pending", "Verified", "Not verified"]);
    assert.match(migration, /create type public\.pnr_verification_status as enum \('Pending', 'Verified', 'Not verified'\);/);
    assert.deepEqual(PNR_STATUSES, ["Active", "Ticketed", "Cancelled", "Expired"], "the PNR status (incl. Ticketed) is kept as it was");
    assert.equal(VERIFY_NOTES_MAX, 500);
  });
});

describe("validateVerification (same rules as verify_pnr)", () => {
  it("needs a result: Verified or Not verified (never Pending)", () => {
    assert.equal(validateVerification(emptyVerification).status, "Choose Verified or Not verified.");
    assert.equal(validateVerification({ status: "Pending", notes: "" }).status, "Choose Verified or Not verified.");
    assert.deepEqual(validateVerification({ status: "Verified", notes: "" }), {}, "notes are optional when verified");
  });

  it("Not verified needs a reason of at least 3 characters", () => {
    assert.equal(validateVerification({ status: "Not verified", notes: "" }).notes, "Say why the PNR could not be verified.");
    assert.equal(validateVerification({ status: "Not verified", notes: "  ab  " }).notes, "Say why the PNR could not be verified.");
    assert.deepEqual(validateVerification({ status: "Not verified", notes: "Airline has no record" }), {});
  });

  it("notes are limited to 500 characters", () => {
    assert.equal(validateVerification({ status: "Verified", notes: "x".repeat(501) }).notes, "Notes can be at most 500 characters.");
    assert.deepEqual(validateVerification({ status: "Verified", notes: "x".repeat(500) }), {});
  });
});

describe("PNR form: airline code", () => {
  const base = { ...emptyPnr, recordLocator: "K7Q2MX" };
  it("is optional, and must be 2 letters or digits", () => {
    assert.deepEqual(validatePnr(base), {});
    assert.deepEqual(validatePnr({ ...base, airline: "ek" }), {}, "lower case is accepted (saved upper case)");
    assert.deepEqual(validatePnr({ ...base, airline: "6E" }), {});
    for (const bad of ["E", "EKA", "E-", "é1"]) assert.equal(validatePnr({ ...base, airline: bad }).airline, "Airline codes are 2 letters or digits (e.g. EK).", bad);
  });
});

describe("resetsVerification (warns before an edit that the database will reset)", () => {
  const verified = { recordLocator: "K7Q2MX", airlineLocator: "EK5ABC", airline: "EK", provider: "Manual", verification: { status: "Verified" } };
  const same = { recordLocator: "K7Q2MX", airlineLocator: "EK5ABC", airline: "EK", provider: "Manual" };

  it("changing the record locator, airline locator, airline or provider resets a checked PNR", () => {
    for (const change of [{ recordLocator: "ZZZ999" }, { airlineLocator: "" }, { airline: "QR" }, { provider: "Amadeus" }]) {
      assert.equal(resetsVerification(verified, { ...same, ...change }), true, JSON.stringify(change));
    }
    assert.equal(resetsVerification({ ...verified, verification: { status: "Not verified" } }, { ...same, airline: "QR" }), true);
  });

  it("the same details (ignoring case and spaces) don't, and a Pending PNR has nothing to reset", () => {
    assert.equal(resetsVerification(verified, same), false);
    assert.equal(resetsVerification(verified, { ...same, recordLocator: " k7q2mx ", airline: "ek" }), false);
    assert.equal(resetsVerification({ ...verified, verification: { status: "Pending" } }, { ...same, airline: "QR" }), false);
  });

  it("covers exactly the fields the database trigger resets on", () => {
    assert.match(migration, /\(new\.record_locator, new\.airline_locator, new\.airline, new\.provider\)\s*is distinct from \(old\.record_locator, old\.airline_locator, old\.airline, old\.provider\)/);
  });
});

describe("server action verifyPnr", () => {
  const actions = read("src/lib/actions/ticketing.ts");
  const fn = actions.slice(actions.indexOf("export async function verifyPnr"), actions.indexOf("export async function saveSegment"));

  it("re-checks the input, checks the PNR is on this booking, then calls verify_pnr with its exact parameters", () => {
    const steps = [
      "const ctx = await withBooking(bookingDbId);",
      'if (!isId(pnrDbId)) return { ok: false, message: "That reservation couldn\'t be found." };',
      "const problem = first(validateVerification(v));",
      '.from("pnr_records").select("id").eq("id", pnrDbId).eq("booking_id", booking.id).maybeSingle();',
      'await supabase.rpc("verify_pnr", { p_pnr_id: pnr.id, p_status: v.status, p_notes: v.notes.trim() || null });',
      'if (error) return { ok: false, message: friendly(error, "verify this reservation") };',
      "refresh();",
    ];
    let at = -1;
    for (const s of steps) {
      const next = fn.indexOf(s, at + 1);
      assert.ok(next > at, `missing or out of order: ${s}`);
      at = next;
    }
    assert.match(migration, /create or replace function public\.verify_pnr\(\s*p_pnr_id uuid,\s*p_status public\.pnr_verification_status,\s*p_notes\s+text\s*\)/);
  });

  it("only Verified / Not verified reach the database; who and when are never sent from the browser", () => {
    assert.match(fn, /status: r\.status === "Verified" \|\| r\.status === "Not verified" \? r\.status : "",/);
    assert.ok(!/verified_by|verified_at|auth\.uid/.test(fn), "the database stamps the user and time");
  });

  it("savePnr saves the airline code and never the verification fields", () => {
    const save = actions.slice(actions.indexOf("export async function savePnr"), actions.indexOf("export async function verifyPnr"));
    assert.match(save, /airline: v\.airline\.trim\(\)\.toUpperCase\(\) \|\| null,/);
    assert.ok(!/verification|verified_/.test(save));
  });
});

describe("data and screens", () => {
  it("the booking's PNRs load the new columns, with the verifier's name from the team", () => {
    const data = read("src/lib/data/ticketing.ts");
    assert.match(data, /"id, record_locator, airline_locator, airline, provider, status, ticketing_deadline, created_at, verification_status, verified_at, verified_by, verification_notes"/);
    assert.match(data, /by: r\.verified_by \? agentName\(team, r\.verified_by\) : undefined,/);
  });

  it("each PNR shows its verification next to (not instead of) its status; Verify is offered to PNR managers on open bookings", () => {
    const panel = read("src/components/tickets/TicketingPanel.tsx");
    assert.match(panel, /<Badge tone=\{PNR_TONE\[r\.status\]\}>\{r\.status\}<\/Badge>\s*<span title=\{verificationSummary\(r\.verification\)\}>\s*<Badge tone=\{VERIFICATION_TONE\[r\.verification\.status\]\}>/);
    assert.match(panel, /\{access\.canManage && !closed && \(\s*<button\s*onClick=\{\(\) => setDialog\(\{ kind: "verify", pnr: r \}\)\}/);
    assert.match(panel, /server\.verifyPnr\(data\.bookingDbId, dialog\.pnr\.id, v\)/);
    const manage = read("src/lib/data/ticketing.ts").match(/const MANAGE_ROLES: AppRole\[\] = \[([^\]]*)\]/)[1];
    assert.equal(manage.replace(/\s/g, ""), '"admin","ticketing_agent"', "the same roles verify_pnr() allows");
  });

  it("the PNR dialog has the airline field and warns before an edit resets the verification", () => {
    const modals = read("src/components/tickets/ticketing-modals.tsx");
    assert.match(modals, /const willReset = pnr \? resetsVerification\(pnr, v\) : false;/);
    assert.match(modals, /\{willReset && \(/);
    assert.match(modals, /<input id="pnrAirlineCode" value=\{v\.airline\} maxLength=\{2\}/);
    const verify = modals.slice(modals.indexOf("export function VerifyPnrModal"), modals.indexOf("/* ─────────────── flight leg"));
    assert.match(verify, /const RESULTS: VerifyPnrValues\["status"\]\[\] = \["Verified", "Not verified"\];/, "Pending is never offered");
    assert.match(verify, /const errors = validateVerification\(v\);/);
  });
});
