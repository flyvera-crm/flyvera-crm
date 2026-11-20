// ⚠️ DEMO DATA ONLY — no real APIs are connected yet.
// Later, replace these exports with functions that fetch from your backend.
import type {
  Activity,
  Flight,
  Kpi,
  LabeledValue,
  LeadStage,
  MonthlyRevenue,
} from "@/types/crm";

export const kpis: Kpi[] = [
  {
    label: "Revenue this month",
    value: 248_650,
    format: "currency",
    delta: 12.4,
    period: "vs last month",
    icon: "wallet",
    trend: [142, 156, 149, 171, 168, 184, 179, 196, 205, 198, 221, 249],
  },
  {
    label: "Bookings",
    value: 386,
    format: "number",
    delta: 8.1,
    period: "vs last month",
    icon: "calendar",
    trend: [260, 272, 281, 290, 284, 301, 318, 309, 330, 342, 357, 386],
  },
  {
    label: "Open leads",
    value: 142,
    format: "number",
    delta: -3.2,
    period: "vs last month",
    icon: "target",
    trend: [150, 162, 158, 149, 155, 160, 152, 148, 151, 147, 146, 142],
  },
  {
    label: "Lead conversion",
    value: 31.6,
    format: "percent",
    delta: 2.3,
    period: "vs last month",
    icon: "users",
    trend: [24, 25, 25, 26, 27, 27, 28, 29, 29, 30, 30, 31.6],
  },
];

export const monthlyRevenue: MonthlyRevenue[] = [
  { month: "Dec", revenue: 142_300 },
  { month: "Jan", revenue: 156_800 },
  { month: "Feb", revenue: 149_200 },
  { month: "Mar", revenue: 171_400 },
  { month: "Apr", revenue: 168_100 },
  { month: "May", revenue: 184_600 },
  { month: "Jun", revenue: 179_300 },
  { month: "Jul", revenue: 196_200 },
  { month: "Aug", revenue: 205_100 },
  { month: "Sep", revenue: 198_400 },
  { month: "Oct", revenue: 221_700 },
  { month: "Nov", revenue: 248_650 },
];

export const topDestinations: LabeledValue[] = [
  { label: "Dubai", value: 84 },
  { label: "London", value: 67 },
  { label: "Maldives", value: 52 },
  { label: "Paris", value: 41 },
  { label: "Bangkok", value: 37 },
  { label: "New York", value: 29 },
];

export const leadPipeline: { stage: LeadStage; count: number; value: number }[] = [
  { stage: "New", count: 48, value: 196_000 },
  { stage: "Contacted", count: 36, value: 158_400 },
  { stage: "Quoted", count: 28, value: 131_200 },
  { stage: "Negotiation", count: 17, value: 92_600 },
  { stage: "Won", count: 13, value: 71_900 },
];

export const upcomingFlights: Flight[] = [
  { id: "f1", flightNo: "EK 202", airline: "Emirates", from: "JFK", to: "DXB", departure: "Today · 22:40", passenger: "Omar Siddiqui", pax: 2, status: "On time" },
  { id: "f2", flightNo: "BA 117", airline: "British Airways", from: "LHR", to: "JFK", departure: "Today · 15:10", passenger: "Hannah Cole", pax: 1, status: "Boarding" },
  { id: "f3", flightNo: "SQ 322", airline: "Singapore Airlines", from: "SIN", to: "LHR", departure: "Tomorrow · 23:55", passenger: "Grace Liu", pax: 3, status: "Scheduled" },
  { id: "f4", flightNo: "QR 701", airline: "Qatar Airways", from: "DOH", to: "JFK", departure: "Tomorrow · 08:20", passenger: "Rahul Mehta", pax: 4, status: "Delayed" },
];

export const recentActivity: Activity[] = [
  { id: "a1", who: "Sara K.", action: "issued tickets for", target: "Amelia Hart", time: "8 min ago", kind: "ticket" },
  { id: "a2", who: "Payment", action: "received from", target: "Grace Liu · $6,310", time: "24 min ago", kind: "payment" },
  { id: "a3", who: "New lead", action: "via WhatsApp from", target: "Fatima Al-Sayed", time: "41 min ago", kind: "whatsapp" },
  { id: "a4", who: "Daniel R.", action: "confirmed booking for", target: "Omar Siddiqui", time: "1 h ago", kind: "booking" },
  { id: "a5", who: "Priya N.", action: "sent a quotation to", target: "Carlos Mendes", time: "2 h ago", kind: "lead" },
];
