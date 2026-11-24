import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { AddCustomerButton } from "@/components/customers/AddCustomerButton";
import { CustomerSummary } from "@/components/customers/CustomerSummary";
import { CustomersTable } from "@/components/customers/CustomersTable";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Sales & Clients"
        title="Customers"
        description="Traveller profiles, tiers and trip history."
        actions={
          <>
            <button className="flex items-center gap-2 rounded-xl border border-navy-100 bg-white px-4 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50">
              <Icon name="document" size={16} /> Export
            </button>
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
