import type { Metadata } from "next";
import { FlightSupplierStatus } from "@/components/flights/FlightSupplierStatus";
import { connectedSuppliers } from "@/lib/flight-suppliers";

export const metadata: Metadata = { title: "Flights" };

// No search form until an authorised supplier is connected (src/lib/flight-suppliers.ts).
export default function Page() {
  return <FlightSupplierStatus suppliers={connectedSuppliers().map(({ name, kind }) => ({ name, kind }))} />;
}
