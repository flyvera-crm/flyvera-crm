import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/icons";
import { WelcomeBanner } from "@/components/dashboard/WelcomeBanner";
import { StatCard } from "@/components/dashboard/StatCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { BarList } from "@/components/dashboard/BarList";
import { LeadPipeline } from "@/components/dashboard/LeadPipeline";
import { RecentBookings } from "@/components/dashboard/RecentBookings";
import { UpcomingFlights } from "@/components/dashboard/UpcomingFlights";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { formatCurrency } from "@/lib/format";
import {
  kpis,
  leadPipeline,
  monthlyRevenue,
  recentActivity,
  topDestinations,
  upcomingFlights,
} from "@/lib/mock-data";

export const metadata: Metadata = { title: "Dashboard" };

function ViewAll({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-sky-brand-dark hover:text-navy-900">
      View all <Icon name="arrowRight" size={14} />
    </Link>
  );
}

export default function DashboardPage() {
  const yearTotal = monthlyRevenue.reduce((sum, m) => sum + m.revenue, 0);

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Performance across sales, bookings and operations. Showing demo data."
        actions={
          <>
            <button className="flex items-center gap-2 rounded-xl border border-navy-100 bg-white px-4 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50">
              <Icon name="calendar" size={16} /> Last 30 days
              <Icon name="chevronDown" size={14} />
            </button>
            <button className="flex items-center gap-2 rounded-xl bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-950 shadow-sm hover:bg-gold-400">
              <Icon name="chart" size={16} /> Export report
            </button>
          </>
        }
      />

      <div className="space-y-6">
        <WelcomeBanner />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <StatCard key={kpi.label} kpi={kpi} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title="Revenue"
              subtitle={`Last 12 months · ${formatCurrency(yearTotal, { compact: true })} total`}
              action={<ViewAll href="/reports" />}
            />
            <div className="px-3 pb-4 pt-2 sm:px-5">
              <RevenueChart data={monthlyRevenue} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Lead pipeline" subtitle="Leads by stage · pipeline value" action={<ViewAll href="/leads" />} />
            <div className="p-5 sm:p-6">
              <LeadPipeline stages={leadPipeline} />
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="overflow-hidden xl:col-span-2">
            <CardHeader title="Recent bookings" subtitle="Latest confirmed and pending trips" action={<ViewAll href="/bookings" />} />
            <div className="mt-4">
              <RecentBookings />
            </div>
          </Card>

          <Card>
            <CardHeader title="Upcoming departures" subtitle="Next 48 hours" action={<ViewAll href="/flights" />} />
            <div className="p-5 sm:p-6">
              <UpcomingFlights flights={upcomingFlights} />
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top destinations" subtitle="Bookings this month" />
            <div className="p-5 sm:p-6">
              <BarList data={topDestinations} unit=" bookings" />
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent activity" subtitle="Across your team" />
            <div className="p-5 sm:p-6">
              <ActivityFeed items={recentActivity} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
