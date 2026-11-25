import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { TicketsWorkspace } from "@/components/tickets/TicketsWorkspace";
import { getTicketList } from "@/lib/data/ticketing";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage() {
  const { tickets, access } = await getTicketList();
  const header = (
    <PageHeader eyebrow="Operations" title="Tickets" description="Issued e-tickets, voids, refunds and exchanges — and bookings still waiting for tickets." />
  );

  if (!access.canSeeTickets) {
    return (
      <>
        {header}
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-400">
            <Icon name="ticket" size={24} />
          </div>
          <p className="mt-4 font-semibold text-navy-900">Your role doesn&apos;t see tickets</p>
          <p className="mt-1 max-w-sm text-sm text-navy-400">
            Tickets contain fares, so they&apos;re handled by ticketing, sales and finance. Flight times are on each booking.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <TicketsWorkspace tickets={tickets} />
    </>
  );
}
