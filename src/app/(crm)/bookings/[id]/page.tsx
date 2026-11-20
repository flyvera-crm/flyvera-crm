import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingView } from "@/components/bookings/BookingView";
import { bookings } from "@/lib/mock-bookings";

// Pre-build each demo booking. Bookings created in the browser are still
// served (dynamicParams defaults to true) and looked up on the client.
export function generateStaticParams() {
  return bookings.map((b) => ({ id: b.id }));
}

export async function generateMetadata({ params }: PageProps<"/bookings/[id]">): Promise<Metadata> {
  const { id } = await params;
  const b = bookings.find((x) => x.id === id);
  return { title: b ? `${b.id} · ${b.title}` : `Booking ${id}` };
}

export default async function BookingPage({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  if (!/^FV-\d+$/.test(id)) notFound();
  return <BookingView id={id} />;
}
