// The quotation-save diagnostic: one server-log line per saveQuote call with ONLY a random request ID,
// the outcome and the quotation code returned by the database. No names, emails, phones, passengers or prices.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUOTE_SAVE_OUTCOMES, quoteSaveLogLine } from "@/lib/quote-save-log";
import { newRequestId } from "@/lib/stage-change-log";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const LINE = /^quotation-save request=(\S+) outcome=(\S+) code=(\S+)$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Everything a quotation carries that must never reach the log.
const SENSITIVE = {
  recipientName: "Amelia Hartley",
  email: "amelia.hartley@example.com",
  phone: "+44 7700 900123",
  passengers: ["Amelia Hartley", "Oliver Hartley"],
  title: "Honeymoon in Santorini",
  destination: "Santorini",
  notes: "Passport AB1234567, allergic to nuts",
  unitPrice: "2,450.00",
  total: 5390.5,
  discount: "120",
  dbId: "4b0c7a52-3f7e-4d55-9a51-0d2f1c9e8a10",
  organizationId: "ee7833f4-0ff6-4a34-96b8-e77c1df92d4e",
  leadCode: "LD-2001",
};
const flat = (v) => (Array.isArray(v) ? v : [String(v)]);

describe("quoteSaveLogLine", () => {
  it("has exactly the five outcomes", () => {
    assert.deepEqual([...QUOTE_SAVE_OUTCOMES], ["ok", "invalid", "not-found", "insert-failed", "items-failed"]);
  });

  it("logs every outcome as one line: request ID, outcome, code", () => {
    for (const outcome of QUOTE_SAVE_OUTCOMES) {
      const requestId = newRequestId();
      const withCode = quoteSaveLogLine({ requestId, outcome, code: "QT-3001" });
      assert.equal(withCode, `quotation-save request=${requestId} outcome=${outcome} code=QT-3001`);
      assert.equal(quoteSaveLogLine({ requestId, outcome }), `quotation-save request=${requestId} outcome=${outcome} code=none`);
      assert.ok(!withCode.includes("\n"));
    }
  });

  it("uses a fresh random request ID for each attempt", () => {
    const ids = Array.from({ length: 200 }, () => newRequestId());
    for (const id of ids) assert.match(id, UUID_V4);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("never logs names, emails, phones, passengers, prices or other details, even when passed in", () => {
    for (const outcome of QUOTE_SAVE_OUTCOMES) {
      const requestId = newRequestId();
      const line = quoteSaveLogLine({ ...SENSITIVE, items: [{ description: "Suite", unitPrice: "980" }], requestId, outcome, code: "QT-3007" });
      const [, id, out, code] = line.match(LINE);
      assert.deepEqual([id, out, code], [requestId, outcome, "QT-3007"]);
      for (const [field, value] of Object.entries(SENSITIVE)) {
        for (const v of flat(value)) assert.ok(!line.includes(v), `${field} must not be logged`);
      }
      assert.ok(!/\d+[.,]\d{2}/.test(line), "no amounts");
    }
  });

  it("replaces anything unexpected instead of copying it into the log", () => {
    const line = quoteSaveLogLine({
      requestId: "amelia.hartley@example.com",
      outcome: "Amelia Hartley",
      code: "QT-3001 total=5390.50\nquotation-save request=x outcome=ok code=QT-1",
    });
    assert.equal(line, "quotation-save request=invalid outcome=unknown code=invalid");
    for (const bad of ["CU-1001", "LD-2001", "qt-3001", "QT-", 3001, { code: "QT-3001" }]) {
      assert.match(quoteSaveLogLine({ requestId: newRequestId(), outcome: "ok", code: bad }), /code=invalid$/);
    }
  });
});

describe("saveQuote logs every exit with the right outcome", () => {
  const actions = read("src/lib/actions/quotations.ts");
  const save = actions.slice(actions.indexOf("export async function saveQuote"), actions.indexOf("async function saveItems"));
  const outcomeOf = (messageFragment) => {
    const at = save.indexOf(messageFragment);
    assert.ok(at > 0, `message not found: ${messageFragment}`);
    const call = save.lastIndexOf("done(", at);
    return save.slice(call).match(/^done\(\s*"([a-z-]+)"/)[1];
  };

  it("one log line per call, with a fresh request ID, written only through quoteSaveLogLine", () => {
    assert.match(save, /const requestId = newRequestId\(\);/);
    assert.match(save, /console\.info\(quoteSaveLogLine\(\{ requestId, outcome, code \}\)\);/);
    const consoleCalls = actions.match(/console\.\w+\(/g) ?? [];
    assert.equal(consoleCalls.length, 1, "the only log call in the file");
  });

  it("every return goes through done(...)", () => {
    const body = save.slice(save.indexOf("const user = await getCurrentUser();"));
    const returns = body.match(/return\s+[^;]*/g) ?? [];
    assert.ok(returns.length >= 12);
    for (const r of returns) assert.match(r, /^return\s+done\(/, r.slice(0, 80));
  });

  it("invalid: no agency, unreadable or invalid details, recipient not available, accepted/declined", () => {
    assert.equal(outcomeOf("Your login isn't linked to an agency yet."), "invalid");
    assert.equal(outcomeOf("The quotation couldn't be read."), "invalid");
    assert.equal(outcomeOf("Some details need attention."), "invalid");
    assert.equal(outcomeOf("Choose who this quotation is for."), "invalid");
    assert.equal(outcomeOf("can't be changed. Duplicate it instead."), "invalid");
  });

  it("not-found: bad ID, missing/invisible quotation, or not readable after saving", () => {
    assert.equal(outcomeOf("That quotation couldn't be found."), "not-found");
    assert.equal(outcomeOf("This quotation no longer exists, or you can't edit it."), "not-found");
    assert.equal(outcomeOf("Saved, but the quotation couldn't be reloaded."), "not-found");
  });

  it("insert-failed: the row wasn't written (refused, or changed meanwhile)", () => {
    assert.match(save, /return done\("insert-failed", \{ ok: false, message: QUOTE_CHANGED_MESSAGE \}\);/);
    assert.match(save, /return done\("insert-failed", \{ ok: false, \.\.\.failure\(saved\.error, "save this quotation"\) \}\);/);
  });

  it("items-failed and ok log the code read back from the database (loadQuote), never a browser value", () => {
    assert.equal(outcomeOf("its items weren't all saved"), "items-failed");
    assert.match(save, /"items-failed",[\s\S]*?quote\?\.id,\s*\);/);
    assert.match(save, /const quote = await loadQuote\(supabase, quoteId\);/);
    assert.match(save, /return done\("ok", \{ ok: true, quote \}, quote\.id\);/);
    // Exactly two calls pass a code, both the code read back from the database.
    assert.equal((save.match(/\},\s*quote\??\.id,?\s*\)/g) ?? []).length, 2);
    // The helper forwards only the outcome and that code (the result object, with any user text, is never logged).
    assert.match(save, /const done = \(outcome: QuoteSaveOutcome, result: SaveQuoteResult, code\?: string\) => \{\s*console\.info\(quoteSaveLogLine\(\{ requestId, outcome, code \}\)\);\s*return result;\s*\};/);
  });
});
