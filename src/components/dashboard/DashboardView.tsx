"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { DashboardFeed } from "@/lib/data/dashboard";
import { useBookings } from "@/lib/booking-store";
import { useLeadList } from "@/lib/lead-store";
import {
  conversionRate,
  dashboardKpis,
  destinationsThisMonth,
  followUpsDue,
  leadPipeline,
  revenueSeries,
  upcomingDepartures,
} from "@/lib/dashboard-metrics";
import { addDays } from "@/lib/customer-history";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { formatCurrency, formatDayMonth } from "@/lib/format";
import { WelcomeBanner } from "./WelcomeBanner";
import { StatCard } from "./StatCard";
import { RevenueChart } from "./RevenueChart";
import { BarList } from "./BarList";
import { LeadPipeline } from "./LeadPipeline";
import { RecentBookings } from "./RecentBookings";
import { UpcomingFlights } from "./UpcomingFlights";
import { ActivityFeed } from "./ActivityFeed";

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-sky-brand-dark hover:text-navy-900">
      {label} <Icon name="arrowRight" size={14} />
    </Link>
  );
}

/**
 * Live dashboard. Bookings and leads come from the shared providers (already filtered by the
 * database for this user's role); departures and activity from the server (`feed`).
 * Numbers that depend on "today" use the visitor's own date, so they appear after hydration.
 */
export function DashboardView({ feed, firstName, scope }: { feed: DashboardFeed; firstName: string; scope: string }) {
  const { bookings, today } = useBookings();
  const leads = useLeadList();
  const { money, leads: showLeads } = feed;
  const access = useMemo(() => ({ money, leads: showLeads }), [money, showLeads]);

  const data = useMemo(() => {
    if (!today) return null;
    return {
      kpis: dashboardKpis(bookings, leads, today, access),
      revenue: revenueSeries(bookings, today, 12),
      pipeline: leadPipeline(leads),
      conversion: conversionRate(leads, { from: addDays(today, -89), to: today }),
      due: followUpsDue(leads, today),
      departures: upcomingDepartures(feed.segments, bookings, today, 7),
      destinations: destinationsThisMonth(bookings, today),
    };
  }, [bookings, leads, today, access, feed.segments]);

  // Placeholder cards (same layout) until the visitor's date is known.
  const placeholderKpis = useMemo(() => dashboardKpis([], [], "2000-01-15", access), [access]);
  const yearTotal = data ? data.revenue.reduce((s, m) => s + m.revenue, 0) : 0;
  const hour = today ? new Date().getHours() : null;

  return (
    <div className="space-y-6">
      <WelcomeBanner
        firstName={firstName}
        hour={hour}
        departures={data ? data.departures.length : null}
        followUps={data ? data.due.length : null}
        showLeads={showLeads}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(data?.kpis ?? placeholderKpis).map((kpi) => (
          <StatCard key={kpi.label} kpi={kpi} pending={!data} />
        ))}
      </div>
      <p className="-mt-3 text-xs text-navy-400">{scope}</p>

      {(money || showLeads) && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {money && (
            <Card className={showLeads ? "xl:col-span-2" : "xl:col-span-3"}>
              <CardHeader
                title="Money received"
                subtitle={`Payments minus refunds · last 12 months${data ? ` · ${formatCurrency(yearTotal, { compact: true })} total` : ""}`}
                action={<ViewAll href="/reports" label="Reports" />}
              />
              <div className="px-3 pb-4 pt-2 sm:px-5">
                {data ? <RevenueChart data={data.revenue} /> : <div className="h-[260px]" />}
              </div>
            </Card>
          )}
          {showLeads && (
            <Card className={money ? undefined : "xl:col-span-3"}>
              <CardHeader title="Lead pipeline" subtitle={money ? "Leads by stage · estimated value" : "Leads by stage"} action={<ViewAll href="/leads" />} />
              <div className="p-5 sm:p-6">
                {data ? <LeadPipeline stages={data.pipeline} conversion={data.conversion} showValue={money} /> : null}
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title="Recent bookings" subtitle="Latest bookings you can see" action={<ViewAll href="/bookings" />} />
          <div className="mt-4">
            <RecentBookings />
          </div>
        </Card>

        <Card>
          <CardHeader title="Upcoming departures" subtitle="Next 7 days · local airport times" action={<ViewAll href="/bookings" />} />
          <div className="p-5 sm:p-6">{data && today ? <UpcomingFlights departures={data.departures} today={today} /> : null}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {showLeads ? (
          <Card>
            <CardHeader title="Follow-ups due" subtitle="Open leads due today or overdue" action={<ViewAll href="/leads" />} />
            <div className="p-5 sm:p-6">
              {data && today ? (
                data.due.length ? (
                  <ul className="divide-y divide-navy-50">
                    {data.due.slice(0, 6).map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-navy-900">{l.name}</span>
                          <span className="text-xs text-navy-400">
                            {l.id} · {l.destination} · {l.stage} · {l.agent}
                          </span>
                        </span>
                        <span className={l.nextFollowUp! < today ? "shrink-0 text-xs font-semibold text-rose-600" : "shrink-0 text-xs font-semibold text-gold-700"}>
                          {l.nextFollowUp! < today ? `Overdue · ${formatDayMonth(l.nextFollowUp!)}` : "Today"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-navy-400">Nothing due — every open lead is on schedule.</p>
                )
              ) : null}
            </div>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Top destinations" subtitle="Bookings created this month" />
            <div className="p-5 sm:p-6">
              {data &&
                (data.destinations.length ? (
                  <BarList data={data.destinations} unit=" bookings" />
                ) : (
                  <p className="py-6 text-center text-sm text-navy-400">No bookings created this month yet.</p>
                ))}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Recent activity" subtitle="Booking and lead updates you can see" />
          <div className="p-5 sm:p-6">
            <ActivityFeed items={feed.activity} />
          </div>
        </Card>
      </div>

      {showLeads && (
        <Card>
          <CardHeader title="Top destinations" subtitle="Bookings created this month" action={<ViewAll href="/reports" label="Reports" />} />
          <div className="p-5 sm:p-6">
            {data &&
              (data.destinations.length ? (
                <BarList data={data.destinations} unit=" bookings" />
              ) : (
                <p className="py-6 text-center text-sm text-navy-400">No bookings created this month yet.</p>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
