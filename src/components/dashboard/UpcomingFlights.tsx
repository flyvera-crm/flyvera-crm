import type { Flight, FlightStatus } from "@/types/crm";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/icons";

const tone: Record<FlightStatus, BadgeTone> = {
  "On time": "success",
  Boarding: "info",
  Scheduled: "neutral",
  Delayed: "warning",
};

export function UpcomingFlights({ flights }: { flights: Flight[] }) {
  return (
    <ul className="space-y-3">
      {flights.map((f) => (
        <li key={f.id} className="rounded-xl border border-navy-100/80 p-3.5 transition hover:border-sky-brand/40 hover:bg-sky-brand-light/30">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-navy-400">
              {f.flightNo} · {f.airline}
            </p>
            <Badge tone={tone[f.status]}>{f.status}</Badge>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-lg font-bold tracking-wide text-navy-900">{f.from}</span>
            <span className="relative flex flex-1 items-center">
              <span className="h-px flex-1 border-t border-dashed border-navy-200" />
              <Icon name="plane" size={16} className="mx-1.5 rotate-45 text-sky-brand" />
              <span className="h-px flex-1 border-t border-dashed border-navy-200" />
            </span>
            <span className="text-lg font-bold tracking-wide text-navy-900">{f.to}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-navy-500">
            <span>
              {f.passenger} {f.pax > 1 && <span className="text-navy-400">+{f.pax - 1}</span>}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="clock" size={13} /> {f.departure}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
