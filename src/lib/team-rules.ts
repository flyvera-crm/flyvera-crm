// Pure team rules (no React / server APIs), shared by the Team screens and the Server Actions.
// The database functions from migration 19 enforce them again.
import { ROLES, type AppRole } from "@/config/roles";

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type InviteValues = { email: string; fullName: string; role: AppRole | ""; teamId: string };

export function validateInvite(v: InviteValues) {
  const e: Partial<Record<keyof InviteValues, string>> = {};
  const email = v.email.trim();
  if (!email) e.email = "Enter their work email.";
  else if (!EMAIL_RE.test(email) || email.length > 254) e.email = "Enter a valid email address.";
  const name = v.fullName.trim();
  if (name.length < 2) e.fullName = "Enter their full name.";
  else if (name.length > 120) e.fullName = "Keep the name under 120 characters.";
  if (!v.role || !ROLES.includes(v.role)) e.role = "Choose a role.";
  return e;
}

export function validateReason(reason: string) {
  const r = reason.trim();
  if (r.length < 5) return "Give a reason (at least 5 characters).";
  if (r.length > 200) return "Keep it under 200 characters.";
  return undefined;
}

export function validateTeamName(name: string) {
  const n = name.trim();
  if (n.length < 2) return "Enter a team name (at least 2 characters).";
  if (n.length > 60) return "Keep it under 60 characters.";
  return undefined;
}

/** Roles that may take over a disabled person's customers, leads, quotations and bookings. */
export const OWNER_ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent"];

export const OPEN_WORK_LABELS = {
  customers: ["customer", "customers"],
  leads: ["open lead", "open leads"],
  quotations: ["draft or sent quotation", "draft or sent quotations"],
  bookings: ["active booking", "active bookings"],
  tasks: ["open task", "open tasks"],
  conversations: ["open WhatsApp conversation", "open WhatsApp conversations"],
} as const;
