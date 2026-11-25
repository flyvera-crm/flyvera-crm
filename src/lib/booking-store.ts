"use client";

// The booking list shared by the whole CRM (Bookings, Payments, Customers, Quotations,
// Dashboard, Reports). Bookings come from Supabase — loaded by the CRM layout on the
// server, filtered by Row Level Security — and every change goes through the Server
// Actions in src/lib/actions/bookings.ts.
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Booking } from "@/types/crm";
import type { BookingAccess } from "@/lib/data/bookings";
import { todayIso, useHydrated } from "@/lib/dates";

type BookingData = {
  bookings: Booking[];
  access: BookingAccess;
  /** Codes of bookings created in this session (shown with a "New" tag). */
  addedIds: Set<string>;
  /** Shows a just-saved booking until the refreshed list from the server arrives. */
  showSaved: (booking: Booking, isNew?: boolean) => void;
};

const BookingDataContext = createContext<BookingData | null>(null);

export function BookingListProvider({
  initialBookings,
  access,
  children,
}: {
  initialBookings: Booking[];
  access: BookingAccess;
  children: ReactNode;
}) {
  const [overlay, setOverlay] = useState<{ base: Booking[]; items: Record<string, Booking> }>({ base: initialBookings, items: {} });
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());

  const bookings = useMemo(() => {
    const items = overlay.base === initialBookings ? overlay.items : {};
    const known = new Set(initialBookings.map((b) => b.id));
    const fresh = Object.values(items).filter((b) => !known.has(b.id));
    return [...fresh, ...initialBookings.map((b) => items[b.id] ?? b)];
  }, [initialBookings, overlay]);

  const showSaved = useCallback(
    (booking: Booking, isNew = false) => {
      setOverlay((o) => ({ base: initialBookings, items: { ...(o.base === initialBookings ? o.items : {}), [booking.id]: booking } }));
      if (isNew) setAddedIds((ids) => new Set(ids).add(booking.id));
    },
    [initialBookings],
  );

  const value = useMemo(() => ({ bookings, access, addedIds, showSaved }), [bookings, access, addedIds, showSaved]);
  return createElement(BookingDataContext.Provider, { value }, children);
}

export function useBookingData() {
  const ctx = useContext(BookingDataContext);
  if (!ctx) throw new Error("useBookingData must be used inside <BookingListProvider>");
  return ctx;
}

/** All bookings this user can see, newest first, plus the visitor's date once hydrated. */
export function useBookings() {
  const { bookings, addedIds } = useBookingData();
  const hydrated = useHydrated();
  const sorted = useMemo(
    () => [...bookings].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true })),
    [bookings],
  );
  return {
    bookings: sorted,
    addedIds,
    hydrated,
    today: hydrated ? todayIso() : null,
  };
}
