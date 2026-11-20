import Link from "next/link";
import { getNavItem } from "@/config/navigation";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

// Shown for modules that are planned but not built yet.
export function ModulePlaceholder({ href }: { href: string }) {
  const item = getNavItem(href);
  return (
    <>
      <PageHeader eyebrow="Module" title={item.label} description={item.description} />
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(14,165,233,0.08),transparent_70%)]" />
        <div className="relative flex flex-col items-center px-6 py-16 text-center sm:py-24">
          <div className="grid size-16 place-items-center rounded-2xl bg-navy-900 text-sky-brand shadow-lg shadow-navy-900/20 ring-4 ring-gold-500/20">
            <Icon name={item.icon} size={28} />
          </div>
          <h2 className="mt-6 text-xl font-semibold text-navy-900">{item.label} is coming soon</h2>
          <p className="mt-2 max-w-md text-sm text-navy-400">
            This module is part of the FLYVERA roadmap. The layout and navigation are ready — features will be added
            in the next build phase.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800"
          >
            Back to dashboard <Icon name="arrowRight" size={16} className="text-gold-300" />
          </Link>
        </div>
      </Card>
    </>
  );
}
