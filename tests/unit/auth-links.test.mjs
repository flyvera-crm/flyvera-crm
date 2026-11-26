// Email-link redirects (/auth/confirm): always in-app paths, never an absolute URL built on the server.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmedPath, EMAIL_LINK_TYPES, EXPIRED_LINK_PATH, isInAppPath } from "@/lib/auth-links";

describe("email-link redirects", () => {
  it("sends each link type to the right in-app page", () => {
    assert.equal(confirmedPath("invite"), "/set-password?welcome=1");
    assert.equal(confirmedPath("recovery"), "/set-password");
    assert.equal(confirmedPath("magiclink"), "/dashboard");
    assert.equal(EXPIRED_LINK_PATH, "/forgot-password?expired=1");
    assert.deepEqual(EMAIL_LINK_TYPES, ["invite", "recovery", "signup", "email", "magiclink"]);
  });

  it("only ever produces paths inside this app (no host, so the browser keeps its own address)", () => {
    for (const t of EMAIL_LINK_TYPES) assert.ok(isInAppPath(confirmedPath(t)), t);
    assert.ok(isInAppPath(EXPIRED_LINK_PATH));
    for (const bad of ["https://0.0.0.0:3000/set-password", "//evil.test/x", "/\\evil.test", "set-password"]) {
      assert.equal(isInAppPath(bad), false, bad);
    }
  });

  it("route builds no absolute URL from the request (the cause of the 0.0.0.0:3000 redirect)", () => {
    const route = readFileSync(new URL("../../src/app/auth/confirm/route.ts", import.meta.url), "utf8");
    const code = route.replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/nextUrl\.clone\(\)/.test(code), "no request.nextUrl.clone()");
    assert.ok(!/NextResponse\.redirect\(/.test(code), "no NextResponse.redirect(absolute URL)");
    assert.ok(/redirect\(confirmedPath\(type\)\)/.test(code) && /redirect\(EXPIRED_LINK_PATH\)/.test(code), "uses in-app paths");
  });
});
