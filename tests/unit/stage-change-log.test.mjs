// The runtime diagnostic for lead stage changes: one log line per Server Action call, readable in the
// Hostinger runtime log. It contains ONLY a random request ID, the requested stage and the outcome:
// no lead/user/organization IDs, names, phones, emails or any other personal data.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Loaded inside each test so every case reports its own result.
const load = () => import("@/lib/stage-change-log");
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LINE = /^lead-stage-change request=(\S+) stage=(\S+) outcome=(\S+)$/;

// Everything that must never reach the log, passed in alongside the allowed fields.
const PERSONAL = {
  dbId: "4b0c7a52-3f7e-4d55-9a51-0d2f1c9e8a10",
  code: "LD-2001",
  name: "Jane Traveller",
  phone: "+1 555 0100",
  email: "jane@example.com",
  userId: "9d1e2f3a-4b5c-4d6e-8f70-112233445566",
  organizationId: "ee7833f4-0ff6-4a34-96b8-e77c1df92d4e",
  passport: "X1234567",
  lostReason: "Chose another agency",
};

describe("newRequestId", () => {
  it("is a random UUID, different every call", async () => {
    const { newRequestId } = await load();
    const ids = Array.from({ length: 200 }, () => newRequestId());
    for (const id of ids) assert.match(id, UUID_V4);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("stageChangeLogLine", () => {
  it("contains exactly the request ID, the requested stage and the outcome", async () => {
    const { stageChangeLogLine, newRequestId } = await load();
    const requestId = newRequestId();
    const line = stageChangeLogLine({ requestId, stage: "New", outcome: "ok" });
    assert.equal(line, `lead-stage-change request=${requestId} stage=New outcome=ok`);
    assert.ok(!line.includes("\n"), "one line");
  });

  it("never includes personal data or other IDs, even when they are passed in", async () => {
    const { stageChangeLogLine, newRequestId } = await load();
    const requestId = newRequestId();
    const line = stageChangeLogLine({ ...PERSONAL, requestId, stage: "Contacted", outcome: "not-found" });
    assert.match(line, LINE);
    const [, id, stage, outcome] = line.match(LINE);
    assert.deepEqual([id, stage, outcome], [requestId, "Contacted", "not-found"]);
    for (const [field, value] of Object.entries(PERSONAL)) {
      assert.ok(!line.includes(value), `${field} must not be logged`);
    }
  });

  it("logs every known outcome and every stage, and nothing else", async () => {
    const { stageChangeLogLine, newRequestId, STAGE_CHANGE_OUTCOMES } = await load();
    assert.deepEqual(
      [...STAGE_CHANGE_OUTCOMES].sort(),
      ["customer-not-found", "invalid-input", "no-membership", "not-found", "ok", "update-failed"],
    );
    for (const outcome of STAGE_CHANGE_OUTCOMES) {
      for (const stage of ["New", "Contacted", "Quoted", "Negotiation", "Won", "Lost"]) {
        const line = stageChangeLogLine({ requestId: newRequestId(), stage, outcome });
        assert.match(line, LINE);
        assert.ok(line.endsWith(`stage=${stage} outcome=${outcome}`));
      }
    }
  });

  it("replaces anything unexpected instead of copying it into the log", async () => {
    const { stageChangeLogLine, newRequestId } = await load();
    const requestId = newRequestId();
    // A stage or request ID taken from the browser could carry text; it must never be echoed.
    const line = stageChangeLogLine({
      requestId: "jane@example.com",
      stage: "New\nlead-stage-change request=x stage=Won outcome=ok",
      outcome: "Jane Traveller",
    });
    assert.equal(line, "lead-stage-change request=invalid stage=invalid outcome=unknown");
    assert.equal(stageChangeLogLine({ requestId, stage: undefined, outcome: "invalid-input" }),
      `lead-stage-change request=${requestId} stage=none outcome=invalid-input`);
  });
});

describe("setLeadStatus writes the diagnostic, and only through stageChangeLogLine", () => {
  it("logs one line per call with a fresh request ID, and has no other logging", () => {
    const actions = read("src/lib/actions/leads.ts");
    assert.match(actions, /import \{[^}]*newRequestId[^}]*stageChangeLogLine[^}]*\} from "@\/lib\/stage-change-log"/);
    const fn = actions.slice(actions.indexOf("export async function setLeadStatus"), actions.indexOf("function cleanPatch"));
    assert.match(fn, /const requestId = newRequestId\(\);/);
    assert.match(fn, /console\.info\(stageChangeLogLine\(/);
    const consoleCalls = actions.match(/console\.\w+\(/g) ?? [];
    const logged = actions.match(/console\.info\(stageChangeLogLine\(/g) ?? [];
    assert.equal(consoleCalls.length, logged.length, "every log call in the file goes through stageChangeLogLine");
  });
});
