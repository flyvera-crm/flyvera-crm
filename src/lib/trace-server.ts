// Server-side helpers for crm-trace lines (see src/lib/trace.ts): which build and process wrote each line,
// and a per-call tracer for Server Actions. Logging only: nothing here changes what an action does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorKind, newTraceId, traceIdOf, traceLine, type TraceAction, type TraceFields, type TraceStage } from "@/lib/trace";

let instance: { build: string; pid: number; started: string } | null = null;

/** The build ID, process ID and process start time of this server process (read once). */
export function instanceFields() {
  if (!instance) {
    let build = "unknown";
    try {
      build = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    } catch {
      /* not a production build */
    }
    instance = { build, pid: process.pid, started: new Date(Date.now() - process.uptime() * 1000).toISOString() };
  }
  return instance;
}

/** Writes one crm-trace line, tagged with this process. */
export function logTrace(stage: TraceStage, fields: TraceFields = {}) {
  console.info(traceLine(stage, { ...fields, ...instanceFields() }));
}

/** Whether the request carries a Supabase login cookie. Only the cookie's NAME is looked at, never its value. */
export async function sessionCookieState() {
  try {
    const { cookies } = await import("next/headers"); // loaded only inside a request
    const names = (await cookies()).getAll().map((c) => c.name);
    return names.some((n) => /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/.test(n)) ? "cookie" : "none";
  } catch {
    return "none";
  }
}

/**
 * Starts tracing one Server Action call: logs "entry" at once. The server always makes its own trace ID;
 * the browser's ID for the click (if it sent a valid one) is logged next to it as client_trace, so the
 * browser's console lines and the server's lines can be matched.
 */
export function startActionTrace(action: TraceAction, clientTraceId: unknown, fields: TraceFields = {}) {
  const trace = newTraceId();
  const client_trace = traceIdOf(clientTraceId);
  const log = (stage: TraceStage, extra: TraceFields = {}) => logTrace(stage, { action, trace, client_trace, ...fields, ...extra });
  log("entry");
  return {
    log,
    /** The action threw: log its type only (never the message), then let it propagate unchanged. */
    threw: (err: unknown) => log("threw", { error: errorKind(err) }),
  };
}
