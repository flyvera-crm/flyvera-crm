import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReportsWorkspace } from "@/components/reports/ReportsWorkspace";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Management"
        title="Reports"
        description="Sales, profit, cash, pipeline and team performance — calculated live from your bookings, quotations and leads."
      />
      <ReportsWorkspace />
    </>
  );
}
