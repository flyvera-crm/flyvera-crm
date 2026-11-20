import type { IconName } from "@/components/icons";
import type { LeadPriority, LeadSource, LeadStage, TripType } from "@/types/crm";

// Pipeline columns, in order. `accent` is the thin bar at the top of each column.
export const LEAD_STAGES: { value: LeadStage; hint: string; accent: string; closed?: boolean }[] = [
  { value: "New", hint: "Not contacted yet", accent: "bg-sky-brand" },
  { value: "Contacted", hint: "First conversation done", accent: "bg-sky-brand-dark" },
  { value: "Quoted", hint: "Quotation sent", accent: "bg-navy-500" },
  { value: "Negotiation", hint: "Finalising details", accent: "bg-navy-800" },
  { value: "Won", hint: "Booked!", accent: "bg-gold-500", closed: true },
  { value: "Lost", hint: "Didn't book", accent: "bg-navy-200", closed: true },
];

export const OPEN_STAGES: LeadStage[] = LEAD_STAGES.filter((s) => !s.closed).map((s) => s.value);
export const isOpenStage = (stage: LeadStage) => OPEN_STAGES.includes(stage);

export const LEAD_SOURCES: { value: LeadSource; icon: IconName }[] = [
  { value: "WhatsApp", icon: "chat" },
  { value: "Website", icon: "globe" },
  { value: "Referral", icon: "users" },
  { value: "Instagram", icon: "sparkles" },
  { value: "Phone", icon: "bell" },
  { value: "Walk-in", icon: "target" },
];

export const LEAD_PRIORITIES: LeadPriority[] = ["Hot", "Warm", "Cold"];

export const TRIP_TYPES: TripType[] = ["Holiday", "Honeymoon", "Family", "Business", "Umrah", "Group"];

export const LOST_REASONS = [
  "Price too high",
  "Booked with a competitor",
  "Trip postponed or cancelled",
  "No response",
  "Visa or travel restrictions",
  "Other",
];
