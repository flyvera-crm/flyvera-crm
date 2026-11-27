// Quotations: status rules, no false "saved" results, no lost failures, honest lead messages.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  confirmQuoteStatus,
  NEXT_STATUS,
  planStatusChange,
  QUOTE_CHANGED_MESSAGE,
  QUOTE_NOT_SAVED_MESSAGE,
} from "@/lib/quote-status";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const NOW = "2026-11-26T22:30:00.000Z";
const SENT_AT = "2026-11-20T10:00:00.000Z";

describe("planStatusChange (which status changes are allowed, and what they write)", () => {
  it("Draft → Sent records when it was sent", () => {
    assert.deepEqual(planStatusChange({ status: "Draft", sent_at: null }, "Sent", NOW), { ok: true, update: { status: "Sent", sent_at: NOW } });
  });

  it("Sent → Sent re-sends (new sent date)", () => {
    assert.deepEqual(planStatusChange({ status: "Sent", sent_at: SENT_AT }, "Sent", NOW), { ok: true, update: { status: "Sent", sent_at: NOW } });
  });

  it("Sent → Accepted / Declined records the answer and keeps the original sent date", () => {
    for (const status of ["Accepted", "Declined"]) {
      assert.deepEqual(planStatusChange({ status: "Sent", sent_at: SENT_AT }, status, NOW), { ok: true, update: { status, responded_at: NOW } });
    }
  });

  it("answering a Draft directly also records it as sent (the database requires a sent date)", () => {
    assert.deepEqual(planStatusChange({ status: "Draft", sent_at: null }, "Accepted", NOW), {
      ok: true,
      update: { status: "Accepted", responded_at: NOW, sent_at: NOW },
    });
  });

  it("Accepted and Declined are final", () => {
    assert.deepEqual(NEXT_STATUS.Accepted, []);
    assert.deepEqual(NEXT_STATUS.Declined, []);
    for (const from of ["Accepted", "Declined"]) {
      for (const to of ["Sent", "Accepted", "Declined"]) {
        const r = planStatusChange({ status: from, sent_at: SENT_AT }, to, NOW);
        assert.equal(r.ok, false, `${from} → ${to}`);
        assert.match(r.message, new RegExp(`A ${from.toLowerCase()} quotation can't be marked ${to.toLowerCase()}`));
      }
    }
  });

  it("refuses anything that isn't a real status (Draft, or text from the browser)", () => {
    for (const bad of ["Draft", "Expired", "accepted", "", null, undefined, 1, { status: "Sent" }]) {
      assert.deepEqual(planStatusChange({ status: "Draft", sent_at: null }, bad, NOW), { ok: false, message: "That status isn't valid." });
    }
  });
});

describe("confirmQuoteStatus (a 'success' must carry the requested status)", () => {
  it("accepts a result whose quotation has the requested status, unchanged", () => {
    const result = { ok: true, quote: { id: "QT-3001", status: "Sent" } };
    assert.equal(confirmQuoteStatus(result, "Sent"), result);
  });

  it("rejects a result whose quotation still has another status, or no quotation", () => {
    for (const bad of [{ ok: true, quote: { id: "QT-3001", status: "Draft" } }, { ok: true }, { ok: true, quote: null }]) {
      assert.deepEqual(confirmQuoteStatus(bad, "Accepted"), { ok: false, message: QUOTE_NOT_SAVED_MESSAGE });
    }
  });

  it("passes a refusal through with its own message", () => {
    const refusal = { ok: false, message: "A declined quotation can't be marked accepted." };
    assert.equal(confirmQuoteStatus(refusal, "Accepted"), refusal);
  });
});

describe("the server only reports changes the database actually made", () => {
  const actions = read("src/lib/actions/quotations.ts");
  const setStatus = actions.slice(actions.indexOf("export async function setQuoteStatus"), actions.indexOf("export async function duplicateQuote"));

  it("a status change applies only if the status is unchanged since it was checked, and must return the row", () => {
    assert.match(setStatus, /const plan = planStatusChange\(current, status, new Date\(\)\.toISOString\(\)\);/);
    assert.match(setStatus, /\.update\(plan\.update\)\s*\.eq\("id", dbId\)\s*\.eq\("status", current\.status\)\s*\.select\("id"\)\s*\.maybeSingle\(\)/);
    assert.match(setStatus, /if \(!changed\) return done\("changed", \{ ok: false, message: QUOTE_CHANGED_MESSAGE \}\);/);
    assert.match(setStatus, /confirmQuoteStatus\(\{ ok: true, quote \}, status\)/);
    assert.ok(!/const \{ error \} = await supabase\.from\("quotations"\)\.update/.test(actions), "no update whose result is ignored");
  });

  it("an edit applies only while the quotation is Draft or Sent, and says so when it was answered meanwhile", () => {
    assert.match(actions, /\.update\(row\)\.eq\("id", existing!\.id\)\.in\("status", \["Draft", "Sent"\]\)\.select\("id"\)\.maybeSingle\(\)/);
    assert.match(actions, /if \(editing && !saved\.error && !saved\.data\) return done\("insert-failed", \{ ok: false, message: QUOTE_CHANGED_MESSAGE \}\);/);
  });

  it("the 'changed meanwhile' message tells the user what to do", () => {
    assert.match(QUOTE_CHANGED_MESSAGE, /changed in the meantime/);
    assert.match(QUOTE_CHANGED_MESSAGE, /Reload the page/);
  });
});

describe("the browser never loses a failure (no crash, the form stays)", () => {
  it("save, status change, duplicate and create-invoice all go through callAction", () => {
    const builder = read("src/components/quotations/QuoteBuilder.tsx");
    const actions = read("src/components/quotations/quote-actions.tsx");
    const view = read("src/components/quotations/QuoteView.tsx");
    assert.match(builder, /await callAction\(\(\) => saveQuote\(\{ dbId: existing\?\.dbId \}, values\), "Quotation save"\)/);
    assert.match(actions, /confirmQuoteStatus\(await callAction\(\(\) => setQuoteStatus\(dbId, status, trace\), "Quotation status change"\), status\)/);
    assert.match(actions, /await callAction\(\(\) => duplicateQuote\(dbId\), "Quotation duplicate"\)/);
    assert.match(view, /await callAction\(\(\) => invoiceFromQuote\(dbId\), "Invoice from quotation"\)/);
    for (const [file, src] of Object.entries({ builder, actions, view })) {
      assert.ok(!/await (saveQuote|setQuoteStatus|duplicateQuote|invoiceFromQuote)\(/.test(src), `${file}: no unguarded call`);
    }
  });

  it("a save refused with field errors still highlights the fields", () => {
    const builder = read("src/components/quotations/QuoteBuilder.tsx");
    assert.match(builder, /const fieldErrors = "fieldErrors" in result \? result\.fieldErrors : undefined;/);
    assert.match(builder, /setServerErrors\(fieldErrors \?\? \{\}\);\s*setServerMessage\(result\.message\);/);
  });
});

describe("the linked lead's message reflects what was saved", () => {
  const actions = read("src/components/quotations/quote-actions.tsx");

  it("sending waits for the lead move and only says 'moved' when it worked", () => {
    assert.match(actions, /const leadResult = move \? await updateLeadStatus\(lead, \{ stage: "Quoted" \}\) : null;/);
    assert.match(actions, /\{lead && leadResult\?\.ok && <> Lead \{lead\.name\} moved to/);
    assert.match(actions, /\{leadResult && !leadResult\.ok && <> The lead wasn&apos;t moved to Quoted: \{leadResult\.message\}<\/>\}/);
  });

  it("accepting waits for the lead move and only says 'moved' when it worked", () => {
    assert.match(actions, /const leadResult = win \? await updateLeadStatus\(lead, \{ stage: "Won", lostReason: null, nextFollowUp: null \}\) : null;/);
    assert.match(actions, /\{leadResult\?\.ok && <> Lead moved to <span className="font-semibold">Won<\/span>\.<\/>\}/);
    assert.match(actions, /\{leadResult && !leadResult\.ok && <> The lead wasn&apos;t moved to Won: \{leadResult\.message\}<\/>\}/);
    assert.ok(!/void updateLeadStatus/.test(actions), "no fire-and-forget lead change");
  });
});
