import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";

const quickActions: { label: string; href: string; icon: IconName }[] = [
  { label: "Add lead", href: "/leads", icon: "target" },
  { label: "New quotation", href: "/quotations", icon: "document" },
  { label: "Search flights", href: "/flights", icon: "plane" },
  { label: "Ask AI", href: "/ai-assistant", icon: "sparkles" },
];

export function WelcomeBanner() {
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
          <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Good morning, Aisha ✈️</h2>
          <p className="mt-2 max-w-xl text-sm text-navy-200 sm:text-base">
            You have <span className="font-semibold text-white">4 departures</span> in the next 48 hours and{" "}
            <span className="font-semibold text-gold-300">12 hot leads</span> waiting for follow-up.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {quickActions.map((a) => (
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
