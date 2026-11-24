import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";

/** Shown to roles that don't work with quotations (support agents). */
export function QuotationsNoAccess() {
  return (
    <>
      <PageHeader eyebrow="Operations" title="Quotations" description="Build, send and track travel quotations." />
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-400">
          <Icon name="document" size={24} />
        </div>
        <p className="mt-4 font-semibold text-navy-900">Your role doesn&apos;t work with quotations</p>
        <p className="mt-1 max-w-sm text-sm text-navy-400">
          Quotations contain prices and margins, so they&apos;re handled by sales, ticketing and finance. Ask an admin if you need access.
        </p>
      </Card>
    </>
  );
}
