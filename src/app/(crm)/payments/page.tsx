import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { PaymentsWorkspace } from "@/components/payments/PaymentsWorkspace";
import { getBookingData } from "@/lib/data/bookings";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  // Bookings (with payments) are loaded once by the CRM layout; here we only need the access check.
  const { access } = await getBookingData();
  const header = (
    <PageHeader eyebrow="Operations" title="Payments" description="Money in from customers, refunds, and what you owe suppliers." />
  );

  if (!access.canSeeMoney) {
    return (
      <>
        {header}
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-400">
            <Icon name="wallet" size={24} />
          </div>
          <p className="mt-4 font-semibold text-navy-900">Your role doesn&apos;t see payments</p>
          <p className="mt-1 max-w-sm text-sm text-navy-400">Payments and prices are handled by sales, ticketing and finance.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <PaymentsWorkspace />
    </>
  );
}
