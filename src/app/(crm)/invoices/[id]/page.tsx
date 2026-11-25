import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { InvoiceView } from "@/components/invoices/InvoiceView";
import { InvoicesNoAccess } from "@/components/invoices/InvoicesNoAccess";
import { getInvoice, invoiceAccess } from "@/lib/data/invoices";
import { getCurrentUser } from "@/lib/auth";

// Invoices are addressed by their database id (drafts have no number yet).
export async function generateMetadata({ params }: PageProps<"/invoices/[id]">): Promise<Metadata> {
  const { id } = await params;
  const data = await getInvoice(id);
  return { title: data?.invoice.number ? `Invoice ${data.invoice.number}` : "Draft invoice" };
}

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!invoiceAccess(user.membership?.role).canView) return <InvoicesNoAccess />;
  const data = await getInvoice(id);
  if (!data) {
    return (
      <Card className="flex flex-col items-center px-6 py-20 text-center">
        <Icon name="document" size={28} className="text-navy-300" />
        <h1 className="mt-4 text-xl font-semibold text-navy-900">Invoice not found</h1>
        <p className="mt-2 max-w-md text-sm text-navy-400">There&apos;s no such invoice on a booking you can see.</p>
        <Link href="/invoices" className="mt-6 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
          All invoices
        </Link>
      </Card>
    );
  }
  return <InvoiceView invoice={data.invoice} history={data.history} access={data.access} bookingCreated={data.bookingCreated} />;
}
