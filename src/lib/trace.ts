// Stage-by-stage request tracing for the Archive and Mark-as-sent actions (browser → proxy → Server Action →
// session → database → response), plus Next.js's own Server Action errors. Pure, unit-tested; used in the
// browser and on the server.
//
// Every line looks like:  crm-trace stage=<stage> key=value ...
// Only the keys below are ever written, each checked against a fixed list or pattern: anything else is
// dropped, and a value that doesn't fit becomes "invalid". So no passwords, session tokens, cookies,
// passport data, names, emails, phones, prices, record IDs or messages can reach a log line.
import { CRM_UPDATED_MESSAGE, SERVER_UNREACHABLE_MESSAGE } from "@/lib/action-call";

export const TRACE_STAGES = [
  "client-start", // browser: the button handler is about to call the Server Action
  "client-end", // browser: the call returned (or failed) and the result is known
  "proxy", // server: src/proxy.ts saw the Server Action request
  "entry", // server: the Server Action function started
  "session", // server: whether the request carries a login cookie (presence only)
  "db-read", // server: the record lookup before a change
  "db-start", // server: about to send the change to the database
  "db-end", // server: the database answered the change
  "exit", // server: the Server Action returned its answer
  "threw", // server: the Server Action threw (error type only)
  "app-start", // server: a Next.js process started
  "next-error", // server: Next.js logged one of its Server Action errors (see NEXT_ERRORS)
  "request-error", // server: Next.js reported an error while handling a request
] as const;
export type TraceStage = (typeof TRACE_STAGES)[number];
export type TraceAction = "archive" | "quote-status";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const oneOf =
  (...allowed: string[]) =>
  (v: unknown) =>
    typeof v === "string" && allowed.includes(v) ? v : "invalid";
const matching = (re: RegExp) => (v: unknown) => (typeof v === "string" && re.test(v) ? v : "invalid");

/** Next.js Server Action errors worth flagging, matched on Next's own log text (the text itself is never logged). */
export const NEXT_ERRORS = [
  ["forward-failed", /^failed to forward action response/],
  ["redirect-response-failed", /^failed to get redirect response/],
  ["origin-mismatch", /does not match `origin` header/],
  ["origin-host-missing", /`x-forwarded-host` or `host` headers are not provided/],
  ["action-not-found", /Failed to find Server Action/],
  ["invalid-action-request", /Invalid Server Actions request/],
] as const;
type NextErrorKind = (typeof NEXT_ERRORS)[number][0];

/** The allowed keys and how each value is checked. Unknown keys are dropped. */
const FIELDS: Record<string, (v: unknown) => string> = {
  action: oneOf("archive", "quote-status"),
  trace: matching(UUID_RE),
  client_trace: matching(UUID_RE), // the browser's own random ID for the click (server lines get their own trace ID)
  kind: oneOf("customer", "lead", "quotation"),
  to: oneOf("Sent", "Accepted", "Declined"),
  outcome: oneOf("ok", "invalid", "not-found", "changed", "update-failed", "refused", "failed", "unreachable", "stale-page"),
  session: oneOf("cookie", "none"),
  signed_in: oneOf("yes", "no"),
  decision: oneOf("next", "open", "redirect-login", "redirect-dashboard"),
  route: matching(/^\/[a-z0-9\-/[\]]{0,80}$/),
  action_id: matching(/^[0-9a-f]{8}$/),
  edge: matching(/^[0-9a-f]{32}-[a-z0-9-]{1,40}$/),
  forwarded: oneOf("yes", "no"),
  db: oneOf("ok", "error", "no-row", "found", "missing"),
  code: matching(/^(?:[0-9A-Z]{5}|PGRST\d{3})$/),
  quote: matching(/^QT-\d{1,9}$/),
  error: matching(/^[A-Za-z-]{1,40}$/),
  next_error: oneOf(...NEXT_ERRORS.map(([k]) => k)),
  method: oneOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"),
  build: matching(/^(?:[A-Za-z0-9_-]{21}|unknown)$/), // a Next.js build ID is exactly 21 characters
  pid: (v) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? String(v) : "invalid"),
  started: matching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/),
};
export const TRACE_FIELDS = Object.keys(FIELDS);

export type TraceFields = Partial<Record<string, unknown>>;

/** One log line. Only known keys, in a fixed order, each value checked. */
export function traceLine(stage: TraceStage, fields: TraceFields = {}) {
  const st = (TRACE_STAGES as readonly string[]).includes(stage) ? stage : "invalid";
  const parts = [`crm-trace stage=${st}`];
  for (const key of TRACE_FIELDS) {
    if (fields[key] === undefined || fields[key] === null) continue;
    parts.push(`${key}=${FIELDS[key](fields[key])}`);
  }
  return parts.join(" ");
}

/** A random ID that ties the browser's lines to the server's lines for one click. */
export const newTraceId = () => globalThis.crypto.randomUUID();
/** A trace ID from the browser, if it is one; otherwise undefined. */
export const traceIdOf = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : undefined);

/** "/quotations/QT-3002" → "/quotations/[id]": record codes and IDs never reach the log. */
export function routePattern(path: unknown) {
  if (typeof path !== "string") return "invalid";
  const clean = path.split("?")[0].split("#")[0];
  return clean
    .split("/")
    .map((seg) => (/^(?:[A-Z]{2}-\d+|[0-9a-f]{8}-[0-9a-f-]{27}|\d+)$/i.test(seg) ? "[id]" : seg.toLowerCase()))
    .join("/");
}

/** The first 8 characters of a Server Action ID (enough to tell actions apart; not a secret). */
export const actionIdPrefix = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{8,}$/.test(v) ? v.slice(0, 8) : undefined);

/** Hostinger's edge request ID, when the edge passes it to the app. */
export const edgeRequestId = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{32}-[a-z0-9-]{1,40}$/.test(v) ? v : undefined);

/** The kind of a thrown value: Next's redirect / not-found, or the error's class name. Never its message. */
export function errorKind(err: unknown) {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
  if (digest.startsWith("NEXT_REDIRECT")) return "redirect";
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND") return "not-found";
  if (err instanceof Error) return /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : "Error";
  return "non-error";
}

/** Which Next.js Server Action error a console.error / console.warn call reports, if any. */
export function detectNextActionError(args: unknown[]): NextErrorKind | null {
  for (const a of args.slice(0, 2)) {
    const text = typeof a === "string" ? a : a instanceof Error ? a.message : "";
    for (const [kind, re] of NEXT_ERRORS) if (re.test(text)) return kind;
  }
  return null;
}

type ConsoleLike = { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
const WATCHED = Symbol.for("crm-trace.next-error-watch");

/**
 * Wraps console.error / console.warn so a Next.js Server Action error also produces one trace line.
 * The original call always runs unchanged (same arguments, same output). Installed once per process.
 */
export function installNextErrorWatch(con: ConsoleLike, onMatch: (kind: NextErrorKind) => void) {
  const c = con as ConsoleLike & { [WATCHED]?: boolean };
  if (c[WATCHED]) return false;
  c[WATCHED] = true;
  for (const method of ["error", "warn"] as const) {
    const original = con[method].bind(con);
    con[method] = (...args: unknown[]) => {
      try {
        const kind = detectNextActionError(args);
        if (kind) onMatch(kind);
      } catch {
        /* tracing never breaks logging */
      }
      original(...args);
    };
  }
  return true;
}

/** How the browser saw a Server Action's answer (for the client-end line). */
export function clientOutcome(result: { ok: boolean; message?: string } | undefined | null) {
  if (!result || typeof result !== "object") return "failed";
  if (result.ok) return "ok";
  if (result.message === SERVER_UNREACHABLE_MESSAGE) return "unreachable";
  if (result.message === CRM_UPDATED_MESSAGE) return "stale-page";
  return "refused";
}
