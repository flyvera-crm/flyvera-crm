// Pre-launch changes: hidden planned modules, security headers, invoice title.
// Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nextConfig, { SECURITY_HEADERS } from "../../next.config.ts";
import { allNavItems, getNavItem, sidebarSections } from "@/config/navigation";
import { invoiceSource, invoiceTitle, settingsFromRow } from "@/lib/settings-rules";

describe("navigation", () => {
  it("leaves planned modules out of the sidebar, but their 'coming soon' pages still work", () => {
    const shown = sidebarSections.flatMap((s) => s.items.map((i) => i.href));
    for (const href of ["/whatsapp", "/ai-assistant"]) {
      assert.ok(!shown.includes(href), `${href} hidden`);
      assert.equal(getNavItem(href).planned, true, `${href} still has its placeholder entry`);
    }
    for (const href of ["/dashboard", "/customers", "/leads", "/flights", "/quotations", "/bookings", "/tickets", "/payments", "/invoices", "/suppliers", "/reports", "/team", "/settings"]) {
      assert.ok(shown.includes(href), `${href} shown`);
    }
    assert.ok(sidebarSections.every((s) => s.items.length > 0), "no empty sections");
    assert.equal(allNavItems.filter((i) => i.planned).length, 2);
  });
});

describe("security headers", () => {
  it("sends every header on all paths and hides the framework", async () => {
    const rules = await nextConfig.headers();
    assert.deepEqual(rules, [{ source: "/:path*", headers: SECURITY_HEADERS }]);
    const h = Object.fromEntries(SECURITY_HEADERS.map((x) => [x.key, x.value]));
    assert.equal(h["X-Frame-Options"], "DENY");
    assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/);
    assert.match(h["Content-Security-Policy"], /form-action 'self'/);
    assert.match(h["Content-Security-Policy"], /base-uri 'self'/);
    assert.match(h["Content-Security-Policy"], /object-src 'none'/);
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.equal(h["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.match(h["Permissions-Policy"], /camera=\(\)/);
    assert.match(h["Strict-Transport-Security"], /max-age=63072000/);
    assert.equal(nextConfig.poweredByHeader, false);
  });
});

describe("invoice title", () => {
  it("says 'Tax invoice' only with a tax registration number", () => {
    assert.equal(invoiceTitle("Unpaid", { taxNumber: "100123456700003" }), "Tax invoice");
    assert.equal(invoiceTitle("Paid", { taxNumber: "" }), "Invoice");
    assert.equal(invoiceTitle("Draft", { taxNumber: "100123456700003" }), "Draft invoice");
  });

  it("follows an issued invoice's frozen copy, not later Settings changes", () => {
    const nowWithTrn = settingsFromRow({ name: "FLYVERA", settings: { profile: { tax_number: "100123456700003" } } });
    const issuedWithoutTrn = invoiceSource({ name: "FLYVERA", terms: ["x"] }, nowWithTrn);
    assert.equal(invoiceTitle("Unpaid", issuedWithoutTrn.profile), "Invoice");
    const draft = invoiceSource(undefined, nowWithTrn);
    assert.equal(invoiceTitle("Unpaid", draft.profile), "Tax invoice");
  });
});
