import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { AddCustomerButton } from "@/components/customers/AddCustomerButton";
import { CustomerSummary } from "@/components/customers/CustomerSummary";
import { CustomersTable } from "@/components/customers/CustomersTable";
import { ExportCustomersButton } from "@/components/customers/ExportCustomersButton";
import { ArchivedListButton } from "@/components/archive/ArchiveControls";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  // Bulk export of contact details: admins only.
  const canExport = (await getCurrentUser()).membership?.role === "admin";
  return (
    <>
      <PageHeader
        eyebrow="Sales & Clients"
        title="Customers"
        description="Traveller profiles, tiers and trip history."
        actions={
          <>
            {canExport && <ArchivedListButton kind="customer" />}
            {canExport && <ExportCustomersButton />}
            <AddCustomerButton />
          </>
        }
      />

      <div className="space-y-6">
        <CustomerSummary />
        <Card className="overflow-hidden">
          <CustomersTable />
        </Card>
      </div>
    </>
  );
}
