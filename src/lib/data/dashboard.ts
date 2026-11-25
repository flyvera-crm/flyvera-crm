// Dashboard data that isn't already loaded for every page: upcoming flight segments and recent
// activity. Bookings and leads come from the shared providers (src/app/(crm)/layout.tsx).
// Row Level Security decides what each role sees; this file only shapes it.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";
import { agentName, getTeam } from "@/lib/data/team";
import { mentionsMoney, type ActivityItem, type DepartureSegment } from "@/lib/dashboard-metrics";

export type { ActivityItem };

export type DashboardFeed = { segments: DepartureSegment[]; activity: ActivityItem[]; money: boolean; leads: boolean };

const MONEY_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent", "finance_manager"];
const LEAD_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "support_agent"];

type SegmentRow = { booking_id: string; marketing_carrier: string; flight_number: string; origin: string; destination: string; departs_at: string; status: DepartureSegment["status"] };
type EventRow = { id: string; body: string; occurred_at: string; created_by: string | null; booking: { code: string } | { code: string }[] | null };
type LeadActivityRow = {
  id: string;
  activity_type: string;
  body: string | null;
  to_stage: string | null;
  occurred_at: string;
  created_by: string | null;
  lead: { code: string; full_name: string } | { code: string; full_name: string }[] | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export const getDashboardFeed = cache(async (): Promise<DashboardFeed> => {
  const user = await getCurrentUser();
  const role = user.membership?.role;
  if (!role) return { segments: [], activity: [], money: false, leads: false };
  const money = MONEY_ROLES.includes(role);
  const leads = LEAD_ROLES.includes(role);
  const supabase = await createClient();
  const team = await getTeam();

  // Segment times are the airport's local clock stored as +00:00, so a day either side covers every
  // visitor's "today"; the browser trims to the exact 7-day window.
  const [segmentsRes, eventsRes, leadRes] = await Promise.all([
    supabase
      .from("booking_segments")
      .select("booking_id, marketing_carrier, flight_number, origin, destination, departs_at, status")
      .gte("departs_at", `${isoDay(-1)}T00:00:00+00:00`)
      .lt("departs_at", `${isoDay(9)}T00:00:00+00:00`)
      .neq("status", "Cancelled")
      .order("departs_at")
      .limit(100),
    supabase
      .from("booking_events")
      .select("id, body, occurred_at, created_by, booking:bookings!booking_events_booking_id_organization_id_fkey(code)")
      .order("occurred_at", { ascending: false })
      .limit(money ? 12 : 30),
    leads
      ? supabase
          .from("lead_activities")
          .select("id, activity_type, body, to_stage, occurred_at, created_by, lead:leads!lead_activities_lead_id_organization_id_fkey(code, full_name)")
          .order("occurred_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as LeadActivityRow[] }),
  ]);

  const segments: DepartureSegment[] = ((segmentsRes.data ?? []) as SegmentRow[]).map((s) => ({
    bookingDbId: s.booking_id,
    flight: `${s.marketing_carrier} ${s.flight_number}`,
    from: s.origin,
    to: s.destination,
    departsAt: s.departs_at.slice(0, 16),
    status: s.status,
  }));

  const who = (id: string | null) => (id ? agentName(team, id) : "System");
  const bookingItems: ActivityItem[] = ((eventsRes.data ?? []) as EventRow[])
    // Roles that can't see money don't get timeline lines that mention amounts.
    .filter((e) => money || !mentionsMoney(e.body))
    .flatMap((e) => {
      const code = one(e.booking)?.code;
      if (!code) return [];
      const kind: ActivityItem["kind"] = /\b(payment|paid|receipt|refund|deposit|invoice)/i.test(e.body)
        ? "payment"
        : /\bticket/i.test(e.body)
          ? "ticket"
          : "booking";
      return [{ id: `b-${e.id}`, at: e.occurred_at, who: who(e.created_by), text: e.body, target: code, href: `/bookings/${code}`, kind }];
    });
  const leadItems: ActivityItem[] = ((leadRes.data ?? []) as LeadActivityRow[]).flatMap((a) => {
    const lead = one(a.lead);
    if (!lead) return [];
    const text =
      a.activity_type === "Stage change" && a.to_stage ? `moved ${lead.full_name} to ${a.to_stage}` : `${a.activity_type}: ${a.body ?? lead.full_name}`;
    return [{ id: `l-${a.id}`, at: a.occurred_at, who: who(a.created_by), text, target: lead.code, href: "/leads", kind: "lead" as const }];
  });

  const activity = [...bookingItems, ...leadItems].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  return { segments, activity, money, leads };
});
