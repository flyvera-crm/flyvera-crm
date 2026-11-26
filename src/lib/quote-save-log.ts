// One diagnostic line per quotation save (Server Action saveQuote), written to the server log
// (Hostinger: the Node.js app's runtime log). Pure, unit-tested.
// It contains ONLY a random request ID, the outcome and the quotation code the database returned.
// Never pass anything else through: no names, emails, phones, passengers, prices or other quotation details.
// Every value is checked against a fixed pattern, so text from the browser is never copied into the log.
//
// Outcomes:
//   ok            saved, and read back from the database (code = the database's code)
//   invalid       refused before writing: not signed in to an agency, unreadable or invalid details,
//                 recipient not available, or an accepted/declined quotation
//   not-found     the quotation to edit isn't there (or isn't visible), or the saved one couldn't be read back
//   insert-failed the quotation row wasn't written (insert or update refused, or it changed meanwhile)
//   items-failed  the quotation was written but its items weren't all saved (code = the database's code)

export const QUOTE_SAVE_OUTCOMES = ["ok", "invalid", "not-found", "insert-failed", "items-failed"] as const;
export type QuoteSaveOutcome = (typeof QUOTE_SAVE_OUTCOMES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_RE = /^QT-\d{1,9}$/;

/** Only these three fields are read; anything else passed in is ignored. */
export function quoteSaveLogLine({ requestId, outcome, code }: { requestId: unknown; outcome: unknown; code?: unknown }) {
  const id = typeof requestId === "string" && UUID_RE.test(requestId) ? requestId : "invalid";
  const out = (QUOTE_SAVE_OUTCOMES as readonly unknown[]).includes(outcome) ? (outcome as string) : "unknown";
  const qt = code === undefined || code === null ? "none" : typeof code === "string" && CODE_RE.test(code) ? code : "invalid";
  return `quotation-save request=${id} outcome=${out} code=${qt}`;
}
