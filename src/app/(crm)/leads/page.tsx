import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { LeadsProvider } from "@/components/leads/LeadsProvider";
import { AddLeadButton } from "@/components/leads/AddLeadButton";
import { LeadSummary } from "@/components/leads/LeadSummary";
import { LeadsWorkspace } from "@/components/leads/LeadsWorkspace";
import { getLeadData } from "@/lib/data/leads";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  // Leads themselves are loaded once by the CRM layout (cached per request); here we only need the access check.
  const { access } = await getLeadData();

  if (!access.canView) {
    return (
      <>
        <PageHeader eyebrow="Sales & Clients" title="Leads" description="Track enquiries from first contact to confirmed booking." />
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-400">
            <Icon name="target" size={24} />
          </div>
          <p className="mt-4 font-semibold text-navy-900">Your role doesn&apos;t work with leads</p>
          <p className="mt-1 max-w-sm text-sm text-navy-400">
            Leads are handled by sales and support. Ask an admin if you need access.
          </p>
        </Card>
      </>
    );
  }

  return (
    // The provider shares the lead list between the summary, board/list and the lead panel.
    <LeadsProvider>
      <PageHeader
        eyebrow="Sales & Clients"
        title="Leads"
        description="Track enquiries from first contact to confirmed booking. Drag cards between stages."
        actions={<AddLeadButton />}
      />
      <div className="space-y-6">
        <LeadSummary />
        <LeadsWorkspace />
      </div>
    </LeadsProvider>
  );
}
