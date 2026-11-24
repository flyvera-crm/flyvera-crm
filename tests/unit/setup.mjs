// Lets Node's test runner load the app's TypeScript modules directly:
// resolves the "@/…" import alias (tsconfig paths) to src/…, adding the .ts / .tsx extension.
// Node 26 strips TypeScript types natively, so no build step is needed.
// Used by `npm run test:unit` (node --import ./tests/unit/setup.mjs).
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SRC = path.resolve(import.meta.dirname, "../../src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
          try {
            return nextResolve(pathToFileURL(candidate).href, context);
          } catch {
            /* a directory: try the next candidate */
          }
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
