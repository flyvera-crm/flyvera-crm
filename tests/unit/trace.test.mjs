// Stage tracing for Archive and Mark-as-sent: browser → proxy → Server Action entry → session → database →
// response, plus Next.js's own Server Action errors ("failed to forward action response", …).
// Lines carry only allow-listed keys with checked values: no passwords, tokens, cookies, passport data,
// names, emails, record IDs or messages. Run with: npm run test:unit
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  actionIdPrefix,
  clientOutcome,
  detectNextActionError,
  edgeRequestId,
  errorKind,
  installNextErrorWatch,
  newTraceId,
  NEXT_ERRORS,
  routePattern,
  TRACE_FIELDS,
  TRACE_STAGES,
  traceIdOf,
  traceLine,
} from "@/lib/trace";
import { CRM_UPDATED_MESSAGE, SERVER_UNREACHABLE_MESSAGE } from "@/lib/action-call";

// Windows working copies may use CRLF line endings; the source checks below compare with "\n".
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const capture = async (fn) => {
  const original = console.info;
  const lines = [];
  console.info = (line) => lines.push(String(line));
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return lines;
};

const SECRETS = {
  password: "Tr0ub4dor&3-correct-horse",
  token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl",
  cookie: "sb-abcdefghijklmnopqrst-auth-token=base64-eyJhY2Nlc3NfdG9rZW4i",
  passport: "AB1234567",
  email: "amelia.hartley@example.com",
  name: "Amelia Hartley",
  phone: "+44 7700 900123",
  dbId: "4b0c7a52-3f7e-4d55-9a51-0d2f1c9e8a10",
  message: "This quotation became booking FV-10476 and stays on record.",
};
const assertClean = (line) => {
  for (const [k, v] of Object.entries(SECRETS)) assert.ok(!line.includes(v), `${k} must never be logged`);
  assert.ok(!/eyJ/.test(line), "nothing that looks like a token");
};

/* ───────────────────────── line format & privacy ───────────────────────── */

describe("traceLine: only allow-listed keys with checked values", () => {
  it("writes the stage and the known keys in a fixed order", () => {
    const trace = newTraceId();
    assert.equal(
      traceLine("db-end", { db: "error", code: "42501", action: "archive", trace, kind: "quotation" }),
      `crm-trace stage=db-end action=archive trace=${trace} kind=quotation db=error code=42501`,
    );
    assert.equal(traceLine("entry"), "crm-trace stage=entry");
  });

  it("covers every stage of the request", () => {
    assert.deepEqual([...TRACE_STAGES], [
      "client-start", "client-end", "proxy", "entry", "session", "db-read", "db-start", "db-end",
      "exit", "threw", "app-start", "next-error", "request-error",
    ]);
    for (const s of TRACE_STAGES) assert.match(traceLine(s), new RegExp(`^crm-trace stage=${s}$`));
    assert.equal(traceLine("password=x"), "crm-trace stage=invalid");
  });

  it("drops unknown keys: passwords, tokens, cookies, passport data and personal details never appear", () => {
    const line = traceLine("entry", { ...SECRETS, headers: { cookie: SECRETS.cookie }, action: "archive" });
    assert.equal(line, "crm-trace stage=entry action=archive");
    assertClean(line);
    for (const k of ["password", "token", "cookie", "cookies", "authorization", "passport", "email", "name", "phone", "message", "dbId", "id", "record"]) {
      assert.ok(!TRACE_FIELDS.includes(k), `no "${k}" key exists`);
    }
  });

  it("a sensitive value put in a known key becomes 'invalid'", () => {
    // trace / client_trace accept random UUIDs by design (the browser's and server's own IDs for a click),
    // so they're covered separately below; every other key rejects a record ID too.
    for (const key of TRACE_FIELDS.filter((k) => k !== "trace" && k !== "client_trace")) {
      for (const value of Object.values(SECRETS)) {
        const line = traceLine("entry", { [key]: value });
        assertClean(line);
      }
    }
    assert.equal(traceLine("proxy", { route: "/quotations/QT-3002?token=abc", edge: SECRETS.token, action_id: "zzzz" }),
      "crm-trace stage=proxy route=invalid action_id=invalid edge=invalid");
  });
});

describe("helpers", () => {
  it("trace IDs are random UUIDs; a browser value is used only if it is one", () => {
    const ids = Array.from({ length: 200 }, newTraceId);
    for (const id of ids) assert.match(id, UUID_V4);
    assert.equal(new Set(ids).size, 200);
    assert.equal(traceIdOf(ids[0]), ids[0]);
    for (const bad of [SECRETS.email, "", undefined, 1, ids[0].toUpperCase()]) assert.equal(traceIdOf(bad), undefined);
  });

  it("routes are logged as patterns: no quotation, customer, lead or booking codes, no IDs, no query", () => {
    assert.equal(routePattern("/quotations/QT-3002"), "/quotations/[id]");
    assert.equal(routePattern("/customers/CU-1001?tab=docs"), "/customers/[id]");
    assert.equal(routePattern("/payments/FV-10476/4b0c7a52-3f7e-4d55-9a51-0d2f1c9e8a10"), "/payments/[id]/[id]");
    assert.equal(routePattern("/leads"), "/leads");
    assert.equal(routePattern(undefined), "invalid");
  });

  it("action ID prefix (8 hex) and Hostinger edge request ID are checked", () => {
    assert.equal(actionIdPrefix("60b99ed8b2aa11"), "60b99ed8");
    assert.equal(actionIdPrefix("not-hex"), undefined);
    assert.equal(edgeRequestId("b1798162fbc1fff7c0e50c6561fdf3bd-kul-edge5"), "b1798162fbc1fff7c0e50c6561fdf3bd-kul-edge5");
    assert.equal(edgeRequestId("b1798162 ; cookie=x"), undefined);
  });

  it("errors are logged by type only, never by message", () => {
    assert.equal(errorKind(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" })), "redirect");
    assert.equal(errorKind(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" })), "not-found");
    assert.equal(errorKind(new TypeError(SECRETS.message)), "TypeError");
    assert.equal(errorKind(SECRETS.password), "non-error");
    assertClean(traceLine("threw", { error: errorKind(new Error(SECRETS.message)) }));
  });

  it("how the browser saw the answer", () => {
    assert.equal(clientOutcome({ ok: true, message: "archived" }), "ok");
    assert.equal(clientOutcome({ ok: false, message: "You don't have permission to archive this quotation." }), "refused");
    assert.equal(clientOutcome({ ok: false, message: SERVER_UNREACHABLE_MESSAGE }), "unreachable");
    assert.equal(clientOutcome({ ok: false, message: CRM_UPDATED_MESSAGE }), "stale-page");
    assert.equal(clientOutcome(undefined), "failed");
  });
});

/* ───────────────────────── Next.js's own Server Action errors ───────────────────────── */

describe("Next.js Server Action errors are detected (including 'failed to forward action')", () => {
  // The exact texts Next.js 16.4.6 logs (node_modules/next/dist/server/app-render/action-handler.js).
  const SAMPLES = {
    "forward-failed": ["failed to forward action response", new TypeError("fetch failed")],
    "redirect-response-failed": ["failed to get redirect response", new Error("x")],
    "origin-mismatch": ["`x-forwarded-host` header with value `0.0.0.0:3000` does not match `origin` header with value `crm.flyvera.us` from a forwarded Server Actions request. Aborting the action."],
    "origin-host-missing": ["`x-forwarded-host` or `host` headers are not provided. One of these is needed to compare the `origin` header from a forwarded Server Actions request. Aborting the action."],
    "action-not-found": [new Error('Failed to find Server Action "60b99ed8". This request might be from an older or newer deployment.')],
    "invalid-action-request": [new Error("Invalid Server Actions request.")],
  };

  it("recognises each one", () => {
    assert.deepEqual(NEXT_ERRORS.map(([k]) => k).sort(), Object.keys(SAMPLES).sort());
    for (const [kind, args] of Object.entries(SAMPLES)) assert.equal(detectNextActionError(args), kind, kind);
  });

  it("ignores everything else", () => {
    for (const args of [["Lead stage change failed", new Error("x")], [SECRETS.message], [], [null], [{ message: "failed to forward action response" }]]) {
      assert.equal(detectNextActionError(args), null);
    }
  });

  it("the console watch adds one trace line and always runs the original call unchanged", () => {
    const calls = { error: [], warn: [] };
    const con = { error: (...a) => calls.error.push(a), warn: (...a) => calls.warn.push(a) };
    const seen = [];
    assert.equal(installNextErrorWatch(con, (k) => seen.push(k)), true);
    assert.equal(installNextErrorWatch(con, (k) => seen.push(k)), false, "installed once");

    const err = new TypeError("fetch failed");
    con.error("failed to forward action response", err);
    con.warn(new Error('Failed to find Server Action "abc"'));
    con.error("something unrelated", SECRETS.password);
    assert.deepEqual(seen, ["forward-failed", "action-not-found"]);
    assert.deepEqual(calls.error, [["failed to forward action response", err], ["something unrelated", SECRETS.password]]);
    assert.equal(calls.warn.length, 1);
  });

  it("a failure inside the watch never breaks logging", () => {
    const out = [];
    const con = { error: (...a) => out.push(a), warn: () => {} };
    installNextErrorWatch(con, () => { throw new Error("boom"); });
    con.error("failed to forward action response");
    assert.equal(out.length, 1);
  });
});

/* ───────────────────────── server tracer (behaviour) ───────────────────────── */

describe("startActionTrace / logTrace (server)", async () => {
  const { instanceFields, logTrace, sessionCookieState, startActionTrace } = await import("@/lib/trace-server");

  it("tags every line with this process: build, pid, start time", async () => {
    const [line] = await capture(() => logTrace("app-start"));
    const i = instanceFields();
    assert.equal(i.pid, process.pid);
    assert.match(line, new RegExp(`^crm-trace stage=app-start build=\\S+ pid=${process.pid} started=\\S+Z$`));
  });

  it("logs 'entry' at once with the server's own trace ID, and the browser's ID as client_trace", async () => {
    const browserTrace = newTraceId();
    const lines = await capture(() => {
      const t = startActionTrace("archive", browserTrace, { kind: "quotation" });
      t.log("db-start");
    });
    const re = new RegExp(`^crm-trace stage=(entry|db-start) action=archive trace=(\\S+) client_trace=${browserTrace} kind=quotation build=`);
    const [, s1, server1] = lines[0].match(re);
    const [, s2, server2] = lines[1].match(re);
    assert.deepEqual([s1, s2], ["entry", "db-start"]);
    assert.match(server1, UUID_V4);
    assert.equal(server1, server2, "one server trace ID per call");
    assert.notEqual(server1, browserTrace, "the server never adopts the browser's value as its own ID");
  });

  it("a browser value that isn't a random ID is dropped, never echoed", async () => {
    const [line] = await capture(() => startActionTrace("quote-status", SECRETS.cookie, { to: "Sent" }));
    assert.match(line.match(/ trace=(\S+)/)[1], UUID_V4);
    assert.ok(!line.includes("client_trace="));
    assertClean(line);
  });

  it("'threw' logs the error type only", async () => {
    const lines = await capture(() => startActionTrace("archive", newTraceId()).threw(new RangeError(SECRETS.message)));
    assert.match(lines[1], /stage=threw .*error=RangeError/);
    assertClean(lines.join("\n"));
  });

  it("outside a request, the session check says 'none' instead of failing", async () => {
    assert.equal(await sessionCookieState(), "none");
  });
});

/* ───────────────────────── wiring: every stage is logged, logic unchanged ───────────────────────── */

const order = (src, markers) => {
  let at = -1;
  for (const m of markers) {
    const next = src.indexOf(m, at + 1);
    assert.ok(next > at, `"${m}" must come after the previous stage`);
    at = next;
  }
};

describe("browser: client-start before the call, client-end after, same trace ID passed to the server", () => {
  it("Archive button", () => {
    const ui = read("src/components/archive/ArchiveControls.tsx");
    order(ui, [
      "const trace = newTraceId();",
      'console.info(traceLine("client-start", { action: "archive", trace, kind }));',
      'await callAction(() => archiveRecord(kind, dbId, trace), "Archive");',
      'console.info(traceLine("client-end", { action: "archive", trace, kind, outcome: clientOutcome(r) }));',
      "toast(",
    ]);
  });

  it("Mark as sent / Accepted / Declined", () => {
    const qa = read("src/components/quotations/quote-actions.tsx");
    order(qa, [
      "const trace = newTraceId();",
      'console.info(traceLine("client-start", { action: "quote-status", trace, to: status }));',
      "setQuoteStatus(dbId, status, trace)",
      'console.info(traceLine("client-end", { action: "quote-status", trace, to: status, outcome: clientOutcome(result) }));',
      "if (!result.ok)",
    ]);
  });
});

describe("proxy: one line for each Server Action request, at every decision; nothing else changes", () => {
  const proxy = read("src/lib/supabase/proxy.ts");

  it("only Server Action requests are logged, without cookies, tokens or record codes", () => {
    assert.match(proxy, /const actionId = request\.headers\.get\("next-action"\);\s*if \(!actionId\) return;/);
    const block = proxy.slice(proxy.indexOf("const traceAction"), proxy.indexOf("if (OPEN_PATHS"));
    for (const field of ["action_id: actionIdPrefix(actionId)", "route: routePattern(path)", 'signed_in: signedIn ? "yes" : "no"', "edge: edgeRequestId(", "forwarded:"]) {
      assert.ok(block.includes(field), field);
    }
    assert.ok(!/cookies|getAll|claims\b|authorization/i.test(block.replace(/signedIn/g, "")), "no cookie, token or claim values");
  });

  it("each exit logs its decision right before returning, and the returns are unchanged", () => {
    order(proxy, [
      'traceAction("open");\n    return response;',
      'traceAction("redirect-login");\n    return withCookies(NextResponse.redirect(to), response);',
      'traceAction("redirect-dashboard");\n    return withCookies(NextResponse.redirect(to), response);',
      'traceAction("next");\n  return response;',
    ]);
    assert.match(proxy, /if \(path !== "\/"\) to\.searchParams\.set\("next", path \+ request\.nextUrl\.search\);/);
  });
});

describe("archiveRecord: entry → session → db-start → database → db-end → exit, or threw", () => {
  const src = read("src/lib/actions/archive.ts");
  const fn = src.slice(src.indexOf("export async function archiveRecord"), src.indexOf("function isRefusal"));

  it("logs every stage in order around the unchanged database call", () => {
    order(fn, [
      'const trace = startActionTrace("archive", traceId, { kind });',
      "try {",
      'trace.log("session", { session: await sessionCookieState() });',
      'trace.log("db-start");',
      "await supabase.rpc(`archive_${k}`, { [`p_${k}_id`]: dbId });",
      'trace.log("db-end", error ? { db: "error", code: error.code } : { db: "ok" });',
      'return done("ok"',
    ]);
    assert.match(fn, /console\.info\(archiveLogLine\(\{ requestId, kind, outcome \}\)\);\s*trace\.log\("exit", \{ outcome \}\);/);
  });

  it("a thrown error is logged by type and re-thrown unchanged", () => {
    assert.match(fn, /\} catch \(err\) \{\s*trace\.threw\(err\);\s*throw err;\s*\}/);
  });

  it("the record ID and messages are never passed to the tracer", () => {
    for (const m of fn.matchAll(/trace\.log\(([^;]*)\);/g)) assert.ok(!/dbId|message|friendly/.test(m[1]), m[1]);
  });
});

describe("setQuoteStatus: entry → session → db-read → db-start → database → db-end → exit, or threw", () => {
  const src = read("src/lib/actions/quotations.ts");
  const fn = src.slice(src.indexOf("export async function setQuoteStatus"), src.indexOf("export async function duplicateQuote"));

  it("logs every stage in order around the unchanged queries", () => {
    order(fn, [
      'const trace = startActionTrace("quote-status", traceId, { to: status });',
      "try {",
      'trace.log("session", { session: await sessionCookieState() });',
      '.select("id, status, sent_at")',
      'trace.log("db-read", { db: current ? "found" : "missing" });',
      'trace.log("db-start");',
      ".update(plan.update)",
      'trace.log("db-end", error ? { db: "error", code: error.code } : { db: changed ? "ok" : "no-row" });',
      'return done(confirmed.ok ? "ok" : "update-failed", confirmed, quote.id);',
    ]);
    assert.match(fn, /trace\.log\("exit", \{ outcome, quote: code \}\);/);
  });

  it("a thrown error is logged by type and re-thrown unchanged", () => {
    assert.match(fn, /\} catch \(err\) \{\s*trace\.threw\(err\);\s*throw err;\s*\}/);
  });

  it("the record ID and messages are never passed to the tracer", () => {
    for (const m of fn.matchAll(/trace\.log\(([^;]*)\);/g)) assert.ok(!/dbId|message|failure/.test(m[1]), m[1]);
  });
});

describe("instrumentation: process start, Next.js action errors, request errors", () => {
  const ins = read("src/instrumentation.ts");

  it("runs only in the Node.js server, logs app-start and installs the Next.js error watch", () => {
    order(ins, [
      'if (process.env.NEXT_RUNTIME !== "nodejs") return;',
      'logTrace("app-start");',
      'installNextErrorWatch(console, (kind) => logTrace("next-error", { next_error: kind }));',
    ]);
  });

  it("request errors log method, route pattern and error type only", () => {
    assert.match(ins, /logTrace\("request-error", \{ method: request\.method, route: routePattern\(request\.path\), error: errorKind\(err\) \}\);/);
  });

  it("the session check reads cookie names only, never values", () => {
    const server = read("src/lib/trace-server.ts");
    assert.match(server, /\.getAll\(\)\.map\(\(c\) => c\.name\)/);
    assert.ok(!/\.value\b/.test(server));
  });
});
