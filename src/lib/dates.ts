"use client";

import { useSyncExternalStore } from "react";

/** Today's date in the user's own timezone, as YYYY-MM-DD. */
export function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/** "2026-11-20" + 3 → "2026-11-23" */
export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const noopSubscribe = () => () => {};

/**
 * false during the server render and the first browser paint, true afterwards.
 * Use it to delay anything that depends on the visitor's own clock or browser storage,
 * so the server HTML and the first browser render always match.
 */
export function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
