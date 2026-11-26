// A lead stage change only counts as saved when the server returns the lead in the stage that was asked for.
// Production case (2026-11-26): "moved to New" was shown, but the response carried the lead still in Contacted
// and nothing was written to the database. Such a result must be rejected: card moved back, error shown.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Loaded inside each test so every case reports its own result.
const load = () => import("@/lib/action-call");
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const lead = (stage) => ({ id: "LD-2001", dbId: "4b0c7a52-3f7e-4d55-9a51-0d2f1c9e8a10", stage });

describe("confirmStageChange (is the returned lead really in the requested stage?)", () => {
  it("accepts a success whose lead has the requested stage, unchanged", async () => {
    const { confirmStageChange } = await load();
    const result = { ok: true, lead: lead("New") };
    assert.equal(confirmStageChange(result, "New"), result);
  });

  it("rejects a success whose lead is in another stage (the production case: New asked, Contacted returned)", async () => {
    const { confirmStageChange, STAGE_NOT_SAVED_MESSAGE } = await load();
    const result = confirmStageChange({ ok: true, lead: lead("Contacted") }, "New");
    assert.deepEqual(result, { ok: false, message: STAGE_NOT_SAVED_MESSAGE });
  });

  it("rejects a success that carries no lead", async () => {
    const { confirmStageChange, STAGE_NOT_SAVED_MESSAGE } = await load();
    for (const bad of [{ ok: true }, { ok: true, lead: null }, { ok: true, lead: {} }]) {
      assert.deepEqual(confirmStageChange(bad, "New"), { ok: false, message: STAGE_NOT_SAVED_MESSAGE });
    }
  });

  it("passes a refusal from the server through unchanged (its own message is shown)", async () => {
    const { confirmStageChange } = await load();
    const refusal = { ok: false, message: "This lead no longer exists, or you can't change it." };
    assert.equal(confirmStageChange(refusal, "New"), refusal);
  });

  it("the error tells the user the change was not saved and what to do", async () => {
    const { STAGE_NOT_SAVED_MESSAGE } = await load();
    assert.equal(STAGE_NOT_SAVED_MESSAGE, "This change wasn't saved. Reload the page and try again.");
  });
});

describe("updateLeadStatus uses the check, reverts the card and shows the error", () => {
  it("checks the returned lead against the requested stage before accepting it", () => {
    const store = read("src/lib/lead-store.ts");
    assert.match(store, /import \{[^}]*confirmStageChange[^}]*\} from "@\/lib\/action-call"/);
    assert.match(store, /confirmStageChange\(\s*await callAction\(\(\) => setLeadStatus\(dbId, patch\), "Lead stage change"\),\s*stage,?\s*\)/);
  });

  it("on a rejected result the card goes back to its saved stage (the optimistic change is dropped)", () => {
    const store = read("src/lib/lead-store.ts");
    assert.match(store, /put\(result\.ok \? result\.lead : undefined, lead\.id\)/);
  });

  it("a rejected result shows its message and never the 'moved to' success", () => {
    const provider = read("src/components/leads/LeadsProvider.tsx");
    const applyMove = provider.slice(provider.indexOf("const applyMove"), provider.indexOf("const moveLead"));
    const failure = applyMove.indexOf("if (!result.ok)");
    assert.ok(failure > 0, "applyMove checks the result");
    assert.match(applyMove.slice(failure), /^if \(!result\.ok\) \{\s*toast\(\{ tone: "info", message: <p>\{result\.message\}<\/p> \}\);\s*return;/);
    assert.ok(failure < applyMove.indexOf("moved to"), "the success message comes only after the check");
  });
});
