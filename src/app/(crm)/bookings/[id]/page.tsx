import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingView } from "@/components/bookings/BookingView";
import { getBookingData } from "@/lib/data/bookings";

// Bookings come from Supabase. getBookingData() is cached per request, so this
// shares the query the CRM layout already ran.
export async function generateMetadata({ params }: PageProps<"/bookings/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { bookings } = await getBookingData();
  const b = bookings.find((x) => x.id === id);
  return { title: b ? `${b.id} · ${b.title}` : `Booking ${id}` };
}

export default async function BookingPage({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  if (!/^FV-\d+$/.test(id)) notFound();
  return <BookingView id={id} />;
}
