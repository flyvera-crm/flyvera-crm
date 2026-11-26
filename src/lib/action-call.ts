// Calls a Server Action from the browser without losing unexpected failures. Pure, unit-tested.
// A Server Action normally answers { ok: true | false, ... }. If the request itself fails (network drop,
// server error, a build mismatch after a redeploy), the call THROWS instead. Without this wrapper that
// error was silently dropped: the screen kept its optimistic change and showed no message.

export const SERVER_UNREACHABLE_MESSAGE =
  "This change couldn't be saved: the server didn't respond. Reload the page and try again.";

export const CRM_UPDATED_MESSAGE = "The CRM was just updated. Reload the page (Ctrl+F5) and try again.";

/**
 * Next.js throws UnrecognizedActionError when the server doesn't know the action this page sent
 * (the page came from another deployment). Matched by name so this file needs no Next.js import.
 */
export function isUnrecognizedAction(error: unknown) {
  return error instanceof Error && error.name === "UnrecognizedActionError";
}

export const STAGE_NOT_SAVED_MESSAGE = "This change wasn't saved. Reload the page and try again.";

type StageResult<L> = { ok: true; lead: L } | { ok: false; message: string };

/**
 * A stage change only counts as saved when the server returns the lead in the stage that was asked for.
 * Anything else (no lead, or the lead still in another stage) becomes an error, so the card moves back
 * and no "moved to" message is shown for a change that didn't happen.
 */
export function confirmStageChange<L extends { stage: string }>(result: StageResult<L>, stage: string): StageResult<L> {
  if (!result.ok) return result;
  return result.lead?.stage === stage ? result : { ok: false, message: STAGE_NOT_SAVED_MESSAGE };
}

/** Runs the action; an unexpected failure becomes { ok: false, message } and is logged to the console. */
export async function callAction<T extends { ok: boolean }>(
  run: () => Promise<T>,
  label: string,
): Promise<T | { ok: false; message: string }> {
  try {
    return await run();
  } catch (error) {
    console.error(`${label} failed`, error); // the exact cause, in the browser console
    return { ok: false, message: isUnrecognizedAction(error) ? CRM_UPDATED_MESSAGE : SERVER_UNREACHABLE_MESSAGE };
  }
}
