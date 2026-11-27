import type { Metadata } from "next";
import { FlightSupplierStatus } from "@/components/flights/FlightSupplierStatus";
import { FlightRequestPanel } from "@/components/flights/FlightRequestPanel";
import { connectedSuppliers } from "@/lib/flight-suppliers";
import { flightRequestStatus } from "@/lib/actions/flight-requests";

export const metadata: Metadata = { title: "Flights" };

// No search form until an authorised supplier is connected (src/lib/flight-suppliers.ts). The AI panel
// only reads a request into details the agent reviews; it never shows fares or availability.
export default async function Page() {
  const ai = await flightRequestStatus();
  return (
    <div className="space-y-6">
      <FlightSupplierStatus suppliers={connectedSuppliers().map(({ name, kind }) => ({ name, kind }))} />
      {ai.allowed && <FlightRequestPanel configured={ai.configured} initialRemaining={ai.remaining} today={new Date().toISOString().slice(0, 10)} />}
    </div>
  );
}
