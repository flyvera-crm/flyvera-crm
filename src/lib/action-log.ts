// Diagnostic lines for quotation status changes and archiving, written to the server log
// (Hostinger: the Node.js app's runtime log). Pure, unit-tested.
// They contain ONLY a random request ID, fixed words (status, record kind, outcome) and a quotation code
// read back from the database. Never pass anything else through: no names, emails, phones, prices,
// record IDs or messages. Every value is checked against a fixed list or pattern, so text from the
// browser is never copied into the log.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_RE = /^QT-\d{1,9}$/;
const pick = (value: unknown, allowed: readonly string[], fallback: string) =>
  typeof value === "string" && allowed.includes(value) ? value : fallback;
const requestIdOf = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : "invalid");

/* ── quotation status (setQuoteStatus) ──
   ok            saved and read back with the requested status (code = the database's code)
   invalid       not a real status, or not allowed from the current status
   not-found     bad ID, the quotation isn't there (or isn't visible), or it couldn't be read back
   changed       its status changed in the meantime, or the database changed no row
   update-failed the database refused the update, or the result didn't have the requested status */
export const QUOTE_STATUS_TARGETS = ["Sent", "Accepted", "Declined"] as const;
export const QUOTE_STATUS_OUTCOMES = ["ok", "invalid", "not-found", "changed", "update-failed"] as const;
export type QuoteStatusOutcome = (typeof QUOTE_STATUS_OUTCOMES)[number];

/** Only these four fields are read; anything else passed in is ignored. */
export function quoteStatusLogLine({ requestId, to, outcome, code }: { requestId: unknown; to: unknown; outcome: unknown; code?: unknown }) {
  const qt = code === undefined || code === null ? "none" : typeof code === "string" && CODE_RE.test(code) ? code : "invalid";
  return (
    `quotation-status request=${requestIdOf(requestId)} to=${pick(to, QUOTE_STATUS_TARGETS, "invalid")} ` +
    `outcome=${pick(outcome, QUOTE_STATUS_OUTCOMES, "unknown")} code=${qt}`
  );
}

/* ── archive (archiveRecord: customers, leads, quotations) ──
   ok       archived
   invalid  unknown kind or bad ID (nothing sent to the database)
   refused  the database refused: no permission, or a business rule (e.g. a quotation that became a booking)
   failed   any other database error */
export const ARCHIVE_KINDS = ["customer", "lead", "quotation"] as const;
export const ARCHIVE_OUTCOMES = ["ok", "invalid", "refused", "failed"] as const;
export type ArchiveOutcome = (typeof ARCHIVE_OUTCOMES)[number];

/** Only these three fields are read; anything else passed in is ignored. */
export function archiveLogLine({ requestId, kind, outcome }: { requestId: unknown; kind: unknown; outcome: unknown }) {
  return `record-archive request=${requestIdOf(requestId)} kind=${pick(kind, ARCHIVE_KINDS, "invalid")} outcome=${pick(outcome, ARCHIVE_OUTCOMES, "unknown")}`;
}
