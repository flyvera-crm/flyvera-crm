import type { NextConfig } from "next";

/**
 * Security headers on every response (see node_modules/next/dist/docs/…/next-config-js/headers.md).
 * The Content-Security-Policy is a safe subset: it stops framing, <base> hijacking, forms posting to other
 * sites and plugins. A script-restricting policy would need per-request nonces and is left for later.
 * HSTS only takes effect over HTTPS (browsers ignore it on http://localhost).
 */
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
