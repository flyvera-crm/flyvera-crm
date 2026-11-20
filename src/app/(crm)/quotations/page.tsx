import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/icons";
import { QuotationsList } from "@/components/quotations/QuotationsList";

export const metadata: Metadata = { title: "Quotations" };

export default function QuotationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Quotations"
        description="Build, send and track travel quotations. Showing demo data."
        actions={
          <Link
            href="/quotations/new"
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
          >
            <Icon name="plus" size={16} className="text-gold-300" /> New quotation
          </Link>
        }
      />
      <QuotationsList />
    </>
  );
}
