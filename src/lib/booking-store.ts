"use client";

// Bookings you create or change are saved in this browser (demo only).
// Later: replace with calls to your backend/API.
import { useMemo, useSyncExternalStore } from "react";
import type { Booking } from "@/types/crm";
import { createLocalCollection } from "@/lib/local-collection";
import { bookings as demoBookings } from "@/lib/mock-bookings";
import { todayIso, useHydrated } from "@/lib/dates";

export const bookingStore = createLocalCollection<Booking>("flyvera.bookings.v1");

/** All bookings (demo + this browser's changes), newest first. */
export function useBookings() {
  const stored = useSyncExternalStore(bookingStore.subscribe, bookingStore.getSnapshot, bookingStore.getServerSnapshot);
  const hydrated = useHydrated();
  const bookings = useMemo(
    () => bookingStore.merge(demoBookings, stored).sort((a, b) => b.id.localeCompare(a.id)),
    [stored],
  );
  const addedIds = useMemo(() => new Set(stored.added.map((b) => b.id)), [stored]);
  return {
    bookings,
    addedIds,
    changedCount: stored.added.length + Object.keys(stored.edited).length,
    hydrated,
    today: hydrated ? todayIso() : null,
  };
}
