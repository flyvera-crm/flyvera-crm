import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";

const quickActions: { label: string; href: string; icon: IconName; leads?: boolean }[] = [
  { label: "Leads", href: "/leads", icon: "target", leads: true },
  { label: "New quotation", href: "/quotations/new", icon: "document" },
  { label: "Bookings", href: "/bookings", icon: "calendar" },
  { label: "Payments", href: "/payments", icon: "card" },
];

/** Greeting with this user's real numbers. `departures` / `followUps` are null until the visitor's date is known. */
export function WelcomeBanner({
  firstName,
  hour,
  departures,
  followUps,
  showLeads,
}: {
  firstName: string;
  /** The visitor's local hour, null before hydration. */
  hour: number | null;
  departures: number | null;
  followUps: number | null;
  showLeads: boolean;
}) {
  const greeting = hour === null ? "Welcome back" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <section className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white sm:p-8">
      {/* decorative layers */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_100%_0%,rgba(14,165,233,0.35),transparent_55%)]" />
      <div className="pointer-events-none absolute -bottom-24 -right-10 size-72 rounded-full border border-gold-500/20" />
      <div className="pointer-events-none absolute -bottom-36 -right-24 size-96 rounded-full border border-gold-500/10" />
      <Icon name="plane" size={140} strokeWidth={0.6} className="pointer-events-none absolute -right-4 top-2 hidden rotate-12 text-white/10 md:block" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-gold-500/15 px-3 py-1 text-xs font-semibold text-gold-300 ring-1 ring-gold-500/30">
            <Icon name="crown" size={14} /> Premium travel desk
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
            {greeting}
            {firstName && <>, {firstName}</>} ✈️
          </h2>
          {departures !== null && (
            <p className="mt-2 max-w-xl text-sm text-navy-200 sm:text-base">
              <span className="font-semibold text-white">{plural(departures, "departure")}</span> in the next 7 days
              {showLeads && followUps !== null && (
                <>
                  {" "}
                  and <span className="font-semibold text-gold-300">{plural(followUps, "lead follow-up")}</span> due
                </>
              )}
              .
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {quickActions
            .filter((a) => showLeads || !a.leads)
            .map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 text-sm font-medium ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20"
              >
                <Icon name={a.icon} size={16} className="text-sky-brand" />
                {a.label}
              </Link>
            ))}
        </div>
      </div>
    </section>
  );
}
