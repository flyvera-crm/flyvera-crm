// Lead stage changes: an unexpected Server Action failure shows an error and moves the card back.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callAction, SERVER_UNREACHABLE_MESSAGE } from "@/lib/action-call";

const quiet = async (fn) => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    return { value: await fn(), logged };
  } finally {
    console.error = original;
  }
};

describe("callAction (Server Action calls from the browser)", () => {
  it("passes a successful answer through unchanged", async () => {
    const answer = { ok: true, lead: { id: "LD-2001", stage: "Contacted" } };
    assert.equal(await callAction(async () => answer, "test"), answer);
  });

  it("passes a refusal from the server through unchanged (its own message is shown)", async () => {
    const answer = { ok: false, message: "This lead no longer exists, or you can't change it." };
    assert.equal(await callAction(async () => answer, "test"), answer);
  });

  it("turns a thrown failure (network, server error, redeploy) into an error message", async () => {
    const { value, logged } = await quiet(() =>
      callAction(async () => {
        throw new TypeError("Failed to fetch");
      }, "Lead stage change"),
    );
    assert.deepEqual(value, { ok: false, message: SERVER_UNREACHABLE_MESSAGE });
    assert.equal(logged.length, 1, "the exact cause is logged to the browser console");
    assert.match(String(logged[0][0]), /Lead stage change failed/);
    assert.ok(logged[0][1] instanceof TypeError);
  });

  it("also catches a synchronous throw", async () => {
    const { value } = await quiet(() =>
      callAction(() => {
        throw new Error("boom");
      }, "test"),
    );
    assert.equal(value.ok, false);
  });
});

describe("lead stage changes use it", () => {
  const store = readFileSync(new URL("../../src/lib/lead-store.ts", import.meta.url), "utf8");

  it("every stage change goes through callAction", () => {
    assert.match(store, /callAction\(\(\) => setLeadStatus\(/);
    assert.equal((store.match(/setLeadStatus\(/g) ?? []).length, 1, "no unguarded setLeadStatus call");
  });

  it("any failure moves the card back (the optimistic change is dropped)", () => {
    assert.match(store, /put\(result\.ok \? result\.lead : undefined, lead\.id\)/);
  });

  it("the board shows the returned message on failure", () => {
    const provider = readFileSync(new URL("../../src/components/leads/LeadsProvider.tsx", import.meta.url), "utf8");
    assert.match(provider, /if \(!result\.ok\) \{\s*toast\(\{ tone: "info", message: <p>\{result\.message\}<\/p> \}\);/);
  });
});
