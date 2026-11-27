import Link from "next/link";
import { getNavItem } from "@/config/navigation";
import type { FlightSupplier } from "@/lib/flight-suppliers";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

// The Flights page states plainly whether live flight data is available. With no supplier connected it
// shows NO search form and NO results: fares and availability only ever come from an authorised supplier.
export function FlightSupplierStatus({ suppliers }: { suppliers: readonly Pick<FlightSupplier, "name" | "kind">[] }) {
  const item = getNavItem("/flights");
  const connected = suppliers.length > 0;
  return (
    <>
      <PageHeader eyebrow="Operations" title={item.label} description="Live fares and availability from authorised flight suppliers." />
      <Card className="px-6 py-8 sm:px-8">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-900 text-sky-brand">
            <Icon name="plane" size={22} />
          </div>
          <div className="min-w-0">
            {connected ? (
              <>
                <h2 className="text-lg font-semibold text-navy-900">Connected flight suppliers</h2>
                <ul className="mt-2 space-y-1 text-sm text-navy-600">
                  {suppliers.map((s) => (
                    <li key={s.name}>
                      <span className="font-medium text-navy-900">{s.name}</span> · {s.kind}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-navy-900" data-testid="no-supplier">
                  No live flight supplier is connected
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-navy-500">
                  Fares and availability appear here only from an authorised GDS, NDC or consolidator connection. Until one is
                  configured, the CRM doesn&apos;t search, show or store flight prices, so nothing here could be mistaken for live
                  availability.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-3 border-t border-navy-50 pt-6 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-navy-50/60 p-4">
            <p className="font-semibold text-navy-900">Working today</p>
            <p className="mt-1 text-navy-500">
              Record a reservation (PNR), check it with the airline or consolidator, and record tickets copied from their e-ticket,
              on each booking.
            </p>
            <Link href="/bookings" className="mt-3 inline-flex items-center gap-1.5 font-semibold text-sky-brand-dark hover:text-navy-900">
              Go to bookings <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <div className="rounded-xl bg-navy-50/60 p-4">
            <p className="font-semibold text-navy-900">After a supplier account is connected</p>
            <p className="mt-1 text-navy-500">
              Live search, fare comparison (baggage, stops, timings, fare rules) and quotations built from the supplier&apos;s actual
              offers. Booking and ticketing through the supplier always need a person&apos;s approval first.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}
