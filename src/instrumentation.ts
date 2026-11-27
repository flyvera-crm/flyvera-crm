// Next.js instrumentation (runs once when a server process starts; see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// Diagnostics only (crm-trace lines, see src/lib/trace.ts):
//  - "app-start": which build and process just started;
//  - "next-error": Next.js logged one of its Server Action errors (e.g. "failed to forward action response");
//  - "request-error": Next.js reported an error while handling a request (route pattern + error type only).
// Nothing here changes how requests are handled, and original log output is left as it was.
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installNextErrorWatch } = await import("@/lib/trace");
  const { logTrace } = await import("@/lib/trace-server");
  logTrace("app-start");
  installNextErrorWatch(console, (kind) => logTrace("next-error", { next_error: kind }));
}

export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { errorKind, routePattern } = await import("@/lib/trace");
  const { logTrace } = await import("@/lib/trace-server");
  logTrace("request-error", { method: request.method, route: routePattern(request.path), error: errorKind(err) });
};
