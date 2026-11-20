import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewBooking } from "@/components/bookings/NewBooking";

export const metadata: Metadata = { title: "New booking" };

export default function NewBookingPage() {
  return (
    <>
      <PageHeader eyebrow="Bookings" title="New booking" description="Turn an accepted quotation into a booking." />
      <NewBooking />
    </>
  );
}
