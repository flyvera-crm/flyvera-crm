import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/icons";
import { QuotationsList } from "@/components/quotations/QuotationsList";
import { QuotationsNoAccess } from "@/components/quotations/QuotationsNoAccess";
import { getQuoteData } from "@/lib/data/quotations";
import { getCurrentUser } from "@/lib/auth";
import { ArchivedListButton } from "@/components/archive/ArchiveControls";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotationsPage() {
  // Quotations are loaded once by the CRM layout (cached per request); here we only need the access check.
  const [{ access }, user] = await Promise.all([getQuoteData(), getCurrentUser()]);
  const isAdmin = user.membership?.role === "admin";
  if (!access.canView) return <QuotationsNoAccess />;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Quotations"
        description="Build, send and track travel quotations."
        actions={
          <>
            {isAdmin && <ArchivedListButton kind="quotation" />}
            {access.canEdit && (
            <Link
              href="/quotations/new"
              className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
            >
              <Icon name="plus" size={16} className="text-gold-300" /> New quotation
            </Link>
            )}
          </>
        }
      />
      <QuotationsList />
    </>
  );
}
