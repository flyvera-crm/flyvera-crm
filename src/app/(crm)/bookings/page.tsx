import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/icons";
import { BookingsList } from "@/components/bookings/BookingsList";

export const metadata: Metadata = { title: "Bookings" };

export default function BookingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Bookings"
        description="Confirmed trips — payments, supplier references and departures. Showing demo data."
        actions={
          <Link
            href="/bookings/new"
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
          >
            <Icon name="plus" size={16} className="text-gold-300" /> New booking
          </Link>
        }
      />
      <BookingsList />
    </>
  );
}
