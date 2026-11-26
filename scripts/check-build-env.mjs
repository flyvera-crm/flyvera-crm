// Runs before every production build (npm run build). Stops the build when the Server Actions key is
// missing or malformed, so a deploy can never ship with a random per-build key.
//
// Why: Next.js derives every Server Action ID from this key. Without it, each build (Hostinger builds
// from a clean checkout) generates a random key, so every action ID changes on every deploy and any
// page or server process from another build fails with "Server Action not found" (409).
// The key's VALUE is never printed, only whether it is present and its size.
import { pathToFileURL } from "node:url";

export const KEY_NAME = "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY";
const VALID_BYTES = [16, 24, 32]; // AES key sizes Next.js accepts
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Checks the key without revealing it. Returns { ok, message }. */
export function checkActionsKey(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return {
      ok: false,
      message: `${KEY_NAME} is not set. Add it to the hosting environment variables (Hostinger: the Node.js app's environment variables), then redeploy.`,
    };
  }
  if (value !== value.trim()) {
    return { ok: false, message: `${KEY_NAME} has spaces or line breaks around it. Remove them and redeploy.` };
  }
  if (!BASE64_RE.test(value) || value.length % 4 !== 0) {
    return { ok: false, message: `${KEY_NAME} is not a valid base64 value. Generate a new 32-byte key and redeploy.` };
  }
  const bytes = Buffer.from(value, "base64").length;
  if (!VALID_BYTES.includes(bytes)) {
    return { ok: false, message: `${KEY_NAME} decodes to ${bytes} bytes; it must be 16, 24 or 32 bytes. Generate a new 32-byte key.` };
  }
  return { ok: true, message: `Server Actions key: present (${bytes} bytes)` };
}

// Command line: load .env files the way `next build` does, then check.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const nextEnv = await import("@next/env"); // CommonJS: its exports arrive on `default`
  const loadEnvConfig = nextEnv.loadEnvConfig ?? nextEnv.default.loadEnvConfig;
  loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });
  const result = checkActionsKey(process.env[KEY_NAME]);
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(`\nBuild stopped: ${result.message}\n`);
    process.exit(1);
  }
}
