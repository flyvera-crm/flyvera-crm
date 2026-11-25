import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/icons";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardFeed } from "@/lib/data/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/** Which records the numbers cover — the database already limits each role to these. */
const SCOPE: Record<string, string> = {
  admin: "Showing the whole agency.",
  sales_manager: "Showing your teams' customers, leads and bookings.",
  sales_agent: "Showing your own customers, leads and bookings.",
  ticketing_agent: "Showing all bookings. Leads aren't part of your role.",
  finance_manager: "Showing all bookings and payments. Leads aren't part of your role.",
  support_agent: "Showing bookings and leads. Prices and payments aren't part of your role.",
};

export default async function DashboardPage() {
  const [user, feed] = await Promise.all([getCurrentUser(), getDashboardFeed()]);
  const role = user.membership?.role;
  const firstName = user.name.includes("@") ? "" : user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="This month at a glance. Figures compare the month so far with the same days last month."
        actions={
          feed.money || feed.leads ? (
            <Link
              href="/reports"
              className="flex items-center gap-2 rounded-xl bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-950 shadow-sm hover:bg-gold-400"
            >
              <Icon name="chart" size={16} /> Reports &amp; exports
            </Link>
          ) : undefined
        }
      />
      <DashboardView feed={feed} firstName={firstName} scope={role ? SCOPE[role] : ""} />
    </>
  );
}
