// Quotation status rules, shared by the server action and the browser. Pure, unit-tested.
import type { QuoteStatus } from "@/types/crm";

export type QuoteAnswer = "Sent" | "Accepted" | "Declined";

/** Which status each status may move to. Accepted and Declined are final. */
export const NEXT_STATUS: Record<QuoteStatus, QuoteStatus[]> = {
  Draft: ["Sent", "Accepted", "Declined"],
  Sent: ["Sent", "Accepted", "Declined"], // "Sent" again = re-sent (e.g. after editing)
  Accepted: [],
  Declined: [],
};

export const QUOTE_CHANGED_MESSAGE =
  "This quotation was changed in the meantime (for example accepted, declined or archived by someone else). Reload the page and check it.";
export const QUOTE_NOT_SAVED_MESSAGE = "This change wasn't saved. Reload the page and try again.";

/**
 * The database update for a status change, or the reason it isn't allowed.
 * `now` is an ISO timestamp. Answering a quotation that was never marked sent also records it as sent.
 */
export function planStatusChange(
  current: { status: QuoteStatus; sent_at: string | null },
  status: unknown,
  now: string,
): { ok: true; update: Record<string, string> } | { ok: false; message: string } {
  if (status !== "Sent" && status !== "Accepted" && status !== "Declined") return { ok: false, message: "That status isn't valid." };
  if (!NEXT_STATUS[current.status].includes(status))
    return { ok: false, message: `A ${current.status.toLowerCase()} quotation can't be marked ${status.toLowerCase()}.` };

  const update: Record<string, string> = { status };
  if (status === "Sent") update.sent_at = now;
  else {
    update.responded_at = now;
    if (!current.sent_at) update.sent_at = now;
  }
  return { ok: true, update };
}

type QuoteResultOf<Q> = { ok: true; quote: Q } | { ok: false; message: string };

/** A status change only counts as saved when the returned quotation has the requested status. */
export function confirmQuoteStatus<Q extends { status: string }>(result: QuoteResultOf<Q>, status: QuoteAnswer): QuoteResultOf<Q> {
  if (!result.ok) return result;
  return result.quote?.status === status ? result : { ok: false, message: QUOTE_NOT_SAVED_MESSAGE };
}
