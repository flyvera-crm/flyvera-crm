import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { LeadsProvider } from "@/components/leads/LeadsProvider";
import { AddLeadButton } from "@/components/leads/AddLeadButton";
import { LeadSummary } from "@/components/leads/LeadSummary";
import { LeadsWorkspace } from "@/components/leads/LeadsWorkspace";
import { leads } from "@/lib/mock-leads";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage() {
  return (
    // The provider shares the lead list between the summary, board/list and the lead panel.
    <LeadsProvider initialLeads={leads}>
      <PageHeader
        eyebrow="Sales & Clients"
        title="Leads"
        description="Track enquiries from first contact to confirmed booking. Drag cards between stages. Showing demo data."
        actions={<AddLeadButton />}
      />
      <div className="space-y-6">
        <LeadSummary />
        <LeadsWorkspace />
      </div>
    </LeadsProvider>
  );
}
