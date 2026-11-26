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
