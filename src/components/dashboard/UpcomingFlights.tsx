import Link from "next/link";
import type { Departure } from "@/lib/dashboard-metrics";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/icons";
import { formatDayMonth } from "@/lib/format";

/** Recorded flights (and trips with no flights recorded yet) departing soon. Times are local to the airport. */
export function UpcomingFlights({ departures, today }: { departures: Departure[]; today: string }) {
  if (!departures.length) return <p className="py-6 text-center text-sm text-navy-400">No departures in the next 7 days.</p>;
  const day = (d: string) => (d === today ? "Today" : formatDayMonth(d));
  return (
    <ul className="space-y-3">
      {departures.map((d) => (
        <li key={d.kind === "flight" ? `${d.booking.id}-${d.segment.flight}-${d.segment.departsAt}` : `${d.booking.id}-trip`}>
          <Link
            href={`/bookings/${d.booking.id}`}
            className="block rounded-xl border border-navy-100/80 p-3.5 transition hover:border-sky-brand/40 hover:bg-sky-brand-light/30"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-navy-400">
                {d.kind === "flight" ? d.segment.flight : "No flights recorded"} · {d.booking.id}
              </p>
              {d.kind === "flight" && d.segment.status !== "Confirmed" ? (
                <Badge tone="warning">{d.segment.status}</Badge>
              ) : (
                <Badge tone={d.date === today ? "info" : "neutral"}>{day(d.date)}</Badge>
              )}
            </div>
            {d.kind === "flight" ? (
              <div className="mt-2 flex items-center gap-3">
                <span className="text-lg font-bold tracking-wide text-navy-900">{d.segment.from}</span>
                <span className="relative flex flex-1 items-center">
                  <span className="h-px flex-1 border-t border-dashed border-navy-200" />
                  <Icon name="plane" size={16} className="mx-1.5 rotate-45 text-sky-brand" />
                  <span className="h-px flex-1 border-t border-dashed border-navy-200" />
                </span>
                <span className="text-lg font-bold tracking-wide text-navy-900">{d.segment.to}</span>
              </div>
            ) : (
              <p className="mt-2 truncate font-medium text-navy-900">{d.booking.destination}</p>
            )}
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-navy-500">
              <span className="truncate">
                {d.booking.customerName}
                {d.booking.adults + d.booking.children > 1 && <span className="text-navy-400"> +{d.booking.adults + d.booking.children - 1}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Icon name="clock" size={13} /> {day(d.date)}
                {d.kind === "flight" && <> · {d.segment.departsAt.slice(11, 16)}</>}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
