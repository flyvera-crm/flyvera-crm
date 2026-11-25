import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";

/** Shown to roles that don't see invoices (support agents). */
export function InvoicesNoAccess() {
  return (
    <>
      <PageHeader eyebrow="Operations" title="Invoices" description="Numbered customer invoices and what's still to collect." />
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-400">
          <Icon name="document" size={24} />
        </div>
        <p className="mt-4 font-semibold text-navy-900">Your role doesn&apos;t see invoices</p>
        <p className="mt-1 max-w-sm text-sm text-navy-400">Invoices contain prices, so they&apos;re handled by finance, sales and ticketing.</p>
      </Card>
    </>
  );
}
