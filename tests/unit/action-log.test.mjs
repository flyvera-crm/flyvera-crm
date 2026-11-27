// Diagnostics for quotation status changes and the shared archive flow (Customers, Leads, Quotations),
// and the archive button's failure guard. Logs carry only a random request ID, fixed words and a
// database-issued quotation code: never names, emails, phones, prices, record IDs or messages.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARCHIVE_KINDS,
  ARCHIVE_OUTCOMES,
  archiveLogLine,
  QUOTE_STATUS_OUTCOMES,
  QUOTE_STATUS_TARGETS,
  quoteStatusLogLine,
} from "@/lib/action-log";
import { newRequestId } from "@/lib/stage-change-log";
import { callAction, SERVER_UNREACHABLE_MESSAGE } from "@/lib/action-call";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const STATUS_LINE = /^quotation-status request=(\S+) to=(\S+) outcome=(\S+) code=(\S+)$/;
const ARCHIVE_LINE = /^record-archive request=(\S+) kind=(\S+) outcome=(\S+)$/;

const SENSITIVE = {
  name: "Amelia Hartley",
  email: "amelia.hartley@example.com",
  phone: "+44 7700 900123",
  passengers: "Amelia Hartley, Oliver Hartley",
  price: "2,450.00",
  total: "5390.50",
  dbId: "4b0c7a52-3f7e-4d55-9a51-0d2f1c9e8a10",
  organizationId: "ee7833f4-0ff6-4a34-96b8-e77c1df92d4e",
  customerCode: "CU-1001",
  leadCode: "LD-2001",
  message: "This quotation became booking FV-10476 and stays on record.",
};
const assertNoSensitive = (line) => {
  for (const [field, value] of Object.entries(SENSITIVE)) assert.ok(!line.includes(value), `${field} must not be logged`);
  assert.ok(!/\d+[.,]\d{2}/.test(line), "no amounts");
};

/* ───────────────────────── quotation status ───────────────────────── */

describe("quoteStatusLogLine", () => {
  it("logs Sent, Accepted and Declined with every outcome: request ID, status, outcome, code", () => {
    assert.deepEqual([...QUOTE_STATUS_TARGETS], ["Sent", "Accepted", "Declined"]);
    assert.deepEqual([...QUOTE_STATUS_OUTCOMES], ["ok", "invalid", "not-found", "changed", "update-failed"]);
    for (const to of QUOTE_STATUS_TARGETS) {
      for (const outcome of QUOTE_STATUS_OUTCOMES) {
        const requestId = newRequestId();
        assert.equal(
          quoteStatusLogLine({ requestId, to, outcome, code: "QT-3001" }),
          `quotation-status request=${requestId} to=${to} outcome=${outcome} code=QT-3001`,
        );
        assert.equal(quoteStatusLogLine({ requestId, to, outcome }), `quotation-status request=${requestId} to=${to} outcome=${outcome} code=none`);
      }
    }
  });

  it("never logs personal data, prices or IDs, even when passed in", () => {
    for (const outcome of QUOTE_STATUS_OUTCOMES) {
      const line = quoteStatusLogLine({ ...SENSITIVE, requestId: newRequestId(), to: "Accepted", outcome, code: "QT-3001" });
      assert.match(line, STATUS_LINE);
      assertNoSensitive(line);
    }
  });

  it("replaces anything unexpected (text from the browser) instead of copying it", () => {
    assert.equal(
      quoteStatusLogLine({ requestId: SENSITIVE.email, to: "Sent\noutcome=ok", outcome: SENSITIVE.name, code: "QT-1 total=5390.50" }),
      "quotation-status request=invalid to=invalid outcome=unknown code=invalid",
    );
    for (const bad of ["Draft", "sent", "", undefined, 1]) assert.match(quoteStatusLogLine({ requestId: newRequestId(), to: bad, outcome: "invalid" }), / to=invalid /);
  });
});

describe("setQuoteStatus logs every exit with the right outcome (logic unchanged)", () => {
  const actions = read("src/lib/actions/quotations.ts");
  const fn = actions.slice(actions.indexOf("export async function setQuoteStatus"), actions.indexOf("export async function duplicateQuote"));
  const outcomeOf = (fragment) => {
    const at = fn.indexOf(fragment);
    assert.ok(at > 0, `not found: ${fragment}`);
    return fn.slice(fn.lastIndexOf("done(", at)).match(/^done\(\s*"([a-z-]+)"/)[1];
  };

  it("one line per call with a fresh request ID and the requested status", () => {
    assert.match(fn, /const requestId = newRequestId\(\);/);
    assert.match(fn, /const done = \(outcome: QuoteStatusOutcome, result: QuoteResult, code\?: string\) => \{\s*console\.info\(quoteStatusLogLine\(\{ requestId, to: status, outcome, code \}\)\);\s*return result;\s*\};/);
    const body = fn.slice(fn.indexOf("if (typeof dbId"));
    for (const r of body.match(/return\s+[^;]*/g)) assert.match(r, /^return\s+done\(/, r.slice(0, 80));
  });

  it("not-found / invalid / changed / update-failed / ok map to the right exits", () => {
    assert.equal(outcomeOf("That quotation couldn't be found."), "not-found");
    assert.equal(outcomeOf("That status isn't valid."), "invalid");
    assert.equal(outcomeOf("This quotation no longer exists, or you can't change it."), "not-found");
    assert.match(fn, /if \(!plan\.ok\) return done\("invalid", plan\);/);
    assert.match(fn, /if \(error\) return done\("update-failed", \{ ok: false, message: failure\(error, "change this quotation"\)\.message \}\);/);
    assert.match(fn, /if \(!changed\) return done\("changed", \{ ok: false, message: QUOTE_CHANGED_MESSAGE \}\);/);
    assert.equal(outcomeOf("Saved, but the quotation couldn't be reloaded."), "not-found");
    assert.match(fn, /const confirmed = confirmQuoteStatus\(\{ ok: true, quote \}, status\);\s*return done\(confirmed\.ok \? "ok" : "update-failed", confirmed, quote\.id\);/);
  });

  it("the guarded update itself is unchanged", () => {
    assert.match(fn, /\.update\(plan\.update\)\s*\.eq\("id", dbId\)\s*\.eq\("status", current\.status\)\s*\.select\("id"\)\s*\.maybeSingle\(\)/);
  });
});

/* ───────────────────────── archive ───────────────────────── */

describe("archiveLogLine", () => {
  it("logs every kind with every outcome: request ID, kind, outcome (no record ID)", () => {
    assert.deepEqual([...ARCHIVE_KINDS], ["customer", "lead", "quotation"]);
    assert.deepEqual([...ARCHIVE_OUTCOMES], ["ok", "invalid", "refused", "failed"]);
    for (const kind of ARCHIVE_KINDS) {
      for (const outcome of ARCHIVE_OUTCOMES) {
        const requestId = newRequestId();
        assert.equal(archiveLogLine({ requestId, kind, outcome }), `record-archive request=${requestId} kind=${kind} outcome=${outcome}`);
      }
    }
  });

  it("never logs personal data or the record's ID, even when passed in", () => {
    for (const outcome of ARCHIVE_OUTCOMES) {
      const line = archiveLogLine({ ...SENSITIVE, requestId: newRequestId(), kind: "customer", outcome });
      assert.match(line, ARCHIVE_LINE);
      assertNoSensitive(line);
    }
  });

  it("replaces anything unexpected instead of copying it", () => {
    assert.equal(
      archiveLogLine({ requestId: SENSITIVE.dbId.toUpperCase(), kind: "customers; drop", outcome: SENSITIVE.message }),
      "record-archive request=invalid kind=invalid outcome=unknown",
    );
  });
});

describe("archiveRecord logs every exit; its answers and permissions are unchanged", () => {
  const src = read("src/lib/actions/archive.ts");
  const fn = src.slice(src.indexOf("export async function archiveRecord"), src.indexOf("function isRefusal"));

  it("one line per call, logging the kind (never the ID)", () => {
    assert.match(fn, /const requestId = newRequestId\(\);/);
    assert.match(fn, /console\.info\(archiveLogLine\(\{ requestId, kind, outcome \}\)\);/);
    assert.equal((src.match(/console\.\w+\(/g) ?? []).length, 1, "the only log call in the file");
    const body = fn.slice(fn.indexOf("if (!KINDS"));
    for (const r of body.match(/return\s+[^;]*/g)) assert.match(r, /^return\s+done\(/, r.slice(0, 80));
  });

  it("invalid → refused/failed → ok, with the same messages as before", () => {
    assert.match(fn, /return done\("invalid", \{ ok: false, message: "That record couldn't be found\." \}\);/);
    assert.match(fn, /if \(error\) return done\(isRefusal\(error\) \? "refused" : "failed", \{ ok: false, message: friendly\(error, `archive this \$\{NOUN\[k\]\}`\) \}\);/);
    assert.match(fn, /return done\("ok", \{ ok: true, message: `The \$\{NOUN\[k\]\} was archived\. An admin can restore it\.` \}\);/);
  });

  it("still archives through the same database function (permissions unchanged)", () => {
    assert.match(fn, /await supabase\.rpc\(`archive_\$\{k\}`, \{ \[`p_\$\{k\}_id`\]: dbId \}\);/);
  });

  it("'refused' = no permission or a business rule; everything else is 'failed'", () => {
    const refusal = src.slice(src.indexOf("function isRefusal"));
    assert.match(refusal, /\/row-level security\|permission denied for\/i\.test\(error\.message\) \|\| \["P0001", "42501"\]\.includes\(error\.code \?\? ""\)/);
    // Same rule friendly() uses to show the database's own message, so log and screen agree.
    assert.match(src, /if \(\/row-level security\|permission denied for\/i\.test\(error\.message\)\) return `You don't have permission to \$\{action\}\.`;/);
    assert.match(src, /if \(\["P0001", "42501"\]\.includes\(error\.code \?\? ""\)\) return error\.message;/);
  });
});

describe("the shared Archive button (Customers, Leads, Quotations) never loses a failure", () => {
  const ui = read("src/components/archive/ArchiveControls.tsx");
  const confirm = ui.slice(ui.indexOf("function confirm()"), ui.indexOf("return (", ui.indexOf("function confirm()")));

  it("goes through callAction; what happens next is unchanged", () => {
    assert.match(confirm, /const r = await callAction\(\(\) => archiveRecord\(kind, dbId\), "Archive"\);/);
    assert.ok(!/await archiveRecord\(/.test(ui), "no unguarded call");
    assert.match(
      confirm,
      /toast\(\{ tone: r\.ok \? undefined : "info", message: <p>\{r\.message\}<\/p> \}\);\s*setOpen\(false\);\s*if \(!r\.ok\) return;\s*onArchived\?\.\(\);\s*if \(kind !== "lead"\) router\.push\(href\);/,
    );
  });

  it("a thrown failure becomes the error message (nothing archived, no redirect)", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const r = await callAction(async () => { throw new TypeError("Failed to fetch"); }, "Archive");
      assert.deepEqual(r, { ok: false, message: SERVER_UNREACHABLE_MESSAGE });
    } finally {
      console.error = original;
    }
  });

  it("an answer from the server passes through unchanged (success and refusal)", async () => {
    const ok = { ok: true, message: "The quotation was archived. An admin can restore it." };
    const refused = { ok: false, message: "This quotation became booking FV-10476 and stays on record." };
    assert.equal(await callAction(async () => ok, "Archive"), ok);
    assert.equal(await callAction(async () => refused, "Archive"), refused);
  });
});
