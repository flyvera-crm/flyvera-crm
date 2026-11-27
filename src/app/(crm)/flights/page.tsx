import type { Metadata } from "next";
import { FlightSupplierStatus } from "@/components/flights/FlightSupplierStatus";
import { FlightRequestPanel } from "@/components/flights/FlightRequestPanel";
import { SavedSearches } from "@/components/flights/SavedSearches";
import { connectedSuppliers } from "@/lib/flight-suppliers";
import { flightRequestStatus } from "@/lib/actions/flight-requests";
import { getSavedSearches, SAVED_SEARCH_LIMIT } from "@/lib/data/flight-searches";

export const metadata: Metadata = { title: "Flights" };

// No search form until an authorised supplier is connected (src/lib/flight-suppliers.ts). The request
// panel only reads a request into details the agent reviews; it never shows fares or availability.
// Saved searches are listed below it (read-only); saving refreshes the page, so a new one appears at once.
export default async function Page() {
  const [reader, saved] = await Promise.all([flightRequestStatus(), getSavedSearches()]);
  return (
    <div className="space-y-6">
      <FlightSupplierStatus suppliers={connectedSuppliers().map(({ name, kind }) => ({ name, kind }))} />
      {reader.allowed && <FlightRequestPanel initialRemaining={reader.remaining} today={new Date().toISOString().slice(0, 10)} />}
      {saved.allowed && <SavedSearches searches={saved.searches} more={saved.more} limit={SAVED_SEARCH_LIMIT} />}
    </div>
  );
}
