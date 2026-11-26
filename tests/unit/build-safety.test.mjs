// Deploy safety: a fixed Server Actions key is required to build, /api/build-info reports what the
// running process loaded (no secrets), and a page from another deployment gets a clear message.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { checkActionsKey, KEY_NAME } from "../../scripts/check-build-env.mjs";
import { actionsFingerprint, buildInfo, serverActionId } from "@/lib/build-info";
import { callAction, CRM_UPDATED_MESSAGE, isUnrecognizedAction, SERVER_UNREACHABLE_MESSAGE } from "@/lib/action-call";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const key = (bytes) => randomBytes(bytes).toString("base64");

describe("the build requires a fixed Server Actions key", () => {
  it("accepts 16, 24 and 32-byte base64 keys, reporting only the size", () => {
    for (const bytes of [16, 24, 32]) {
      const value = key(bytes);
      const result = checkActionsKey(value);
      assert.equal(result.ok, true);
      assert.equal(result.message, `Server Actions key: present (${bytes} bytes)`);
      assert.ok(!result.message.includes(value), "the key value is never printed");
    }
  });

  it("rejects a missing, blank, padded, non-base64 or wrong-size key, never echoing it", () => {
    const bad = [undefined, "", "   ", ` ${key(32)}`, `${key(32)}\n`, "not*base64*at*all", key(20), key(64)];
    for (const value of bad) {
      const result = checkActionsKey(value);
      assert.equal(result.ok, false, String(value));
      assert.ok(result.message.includes(KEY_NAME));
      if (value && value.trim()) assert.ok(!result.message.includes(value.trim()), "the key value is never printed");
    }
  });

  it("npm run build runs the check before next build, and the script stops a build without the key", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.scripts.build, "node scripts/check-build-env.mjs && next build --webpack");

    const env = { ...process.env, [KEY_NAME]: "" };
    assert.throws(
      () => execFileSync(process.execPath, ["scripts/check-build-env.mjs"], { env, stdio: "pipe" }),
      (err) => err.status === 1 && /Build stopped/.test(String(err.stderr)),
    );
    const value = key(32);
    const out = execFileSync(process.execPath, ["scripts/check-build-env.mjs"], {
      env: { ...process.env, [KEY_NAME]: value },
      encoding: "utf8",
    });
    assert.equal(out.trim(), "Server Actions key: present (32 bytes)");
    assert.ok(!out.includes(value));
  });
});

describe("/api/build-info", () => {
  const ids = ["60014b15425d5d7e3ef95eed44aa32d9eed9f19a0d", "6092be365060c29f5561ec052766dbf9dcd7245ac5"];

  it("fingerprints the action IDs: same IDs = same value, in any order; different IDs = different value", () => {
    const a = actionsFingerprint(ids);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(actionsFingerprint([...ids].reverse()), a);
    assert.notEqual(actionsFingerprint([ids[0], "60db99fe5949" + "0".repeat(30)]), a);
    assert.ok(!ids.some((id) => a.includes(id)), "returns a hash, not the IDs");
  });

  it("says 'unavailable' instead of guessing when an ID can't be read", () => {
    assert.equal(actionsFingerprint([]), "unavailable");
    assert.equal(actionsFingerprint([ids[0], undefined]), "unavailable");
    assert.equal(serverActionId(() => {}), undefined);
    assert.equal(serverActionId(Object.assign(() => {}, { $$id: ids[0] })), ids[0]);
  });

  it("returns only the build id, the fingerprint and the process start time", () => {
    const info = buildInfo("cYPS38z8c945uw2RxNi3M", ids, 90, Date.parse("2026-11-26T19:00:00Z"));
    assert.deepEqual(Object.keys(info).sort(), ["actionsFingerprint", "buildId", "processStartedAt"]);
    assert.equal(info.buildId, "cYPS38z8c945uw2RxNi3M");
    assert.equal(info.processStartedAt, "2026-11-26T18:58:30.000Z");
    assert.equal(buildInfo("bad id\n<x>", ids, 0).buildId, "unknown");
  });

  it("the route is read-only, uncached, reads no env/secrets, and is reachable without login", () => {
    const route = read("src/app/api/build-info/route.ts");
    assert.match(route, /export function GET\(\)/);
    assert.ok(!/export (async )?function (POST|PUT|PATCH|DELETE)/.test(route));
    assert.match(route, /no-store/);
    assert.ok(!/process\.env|supabase|createClient/i.test(route.replace(/^\s*\/\/.*$/gm, "")));
    assert.match(read("src/lib/supabase/proxy.ts"), /OPEN_PATHS = \["\/auth\/confirm", "\/api\/build-info"\]/);
  });
});

describe("a page from another deployment", () => {
  const quiet = async (fn) => {
    const original = console.error;
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.error = original;
    }
  };

  it("gets 'The CRM was just updated' when Next.js reports an unknown action", async () => {
    const err = Object.assign(new Error('Server Action "60…" was not found on the server.'), { name: "UnrecognizedActionError" });
    assert.equal(isUnrecognizedAction(err), true);
    const result = await quiet(() => callAction(async () => { throw err; }, "Lead stage change"));
    assert.deepEqual(result, { ok: false, message: CRM_UPDATED_MESSAGE });
  });

  it("other failures keep the general message", async () => {
    assert.equal(isUnrecognizedAction(new TypeError("Failed to fetch")), false);
    assert.equal(isUnrecognizedAction({ name: "UnrecognizedActionError" }), false, "only real errors");
    const result = await quiet(() => callAction(async () => { throw new TypeError("Failed to fetch"); }, "x"));
    assert.deepEqual(result, { ok: false, message: SERVER_UNREACHABLE_MESSAGE });
  });
});
