import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { InvoicesWorkspace } from "@/components/invoices/InvoicesWorkspace";
import { InvoicesNoAccess } from "@/components/invoices/InvoicesNoAccess";
import { getInvoices } from "@/lib/data/invoices";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const { invoices, access } = await getInvoices();
  if (!access.canView) return <InvoicesNoAccess />;
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Invoices"
        description={
          access.canManage
            ? "Numbered customer invoices. Create one from a booking (or an accepted quotation), review the draft, then issue it."
            : "Numbered customer invoices — read and print. Finance creates and issues them."
        }
      />
      <InvoicesWorkspace invoices={invoices} />
    </>
  );
}
