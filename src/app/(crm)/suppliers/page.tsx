import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { SuppliersWorkspace } from "@/components/suppliers/SuppliersWorkspace";
import { getSuppliers } from "@/lib/data/suppliers";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const { suppliers, access } = await getSuppliers();
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Suppliers"
        description={
          access.canManage
            ? "Airlines, hotels and partners you book with. Link them to booked services; deactivate rather than delete."
            : "Airlines, hotels and partners the agency books with."
        }
      />
      {access.canView ? (
        <SuppliersWorkspace suppliers={suppliers} canManage={access.canManage} />
      ) : (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <Icon name="globe" size={28} className="text-navy-300" />
          <p className="mt-3 font-semibold text-navy-900">Suppliers aren&apos;t part of your role</p>
          <p className="mt-1 text-sm text-navy-400">Ticketing and finance look after suppliers.</p>
        </Card>
      )}
    </>
  );
}
