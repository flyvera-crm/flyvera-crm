// Customer list → CSV (pure, unit-tested). Admin-only in the UI: it's a bulk copy of contact details.
// Deliberately leaves out passports, dates of birth and notes.
import type { Customer } from "@/types/crm";
import { toCsv } from "@/lib/report-metrics";

/**
 * Spreadsheet apps run cells that start with = + - @ as formulas ("CSV injection"), and turn
 * "+971…" phone numbers into plain numbers. A leading apostrophe keeps such cells as text.
 */
export function safeCell(value: string | number | null | undefined) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export const CUSTOMER_CSV_HEADER = [
  "Customer",
  "Name",
  "Email",
  "Phone",
  "City",
  "Country",
  "Tier",
  "Status",
  "Trips",
  "Lifetime value",
  "Last trip",
  "Assigned to",
  "Joined",
];

export function customersCsv(customers: Customer[]) {
  const rows = [...customers]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((c) =>
      [
        c.id,
        c.name,
        c.email,
        c.phone,
        c.city,
        c.country,
        c.tier,
        c.status,
        c.statsHidden ? "" : c.trips,
        c.statsHidden ? "" : c.lifetimeValue,
        c.statsHidden ? "" : (c.lastTrip ?? ""),
        c.agent,
        c.joined,
      ].map(safeCell),
    );
  return toCsv([CUSTOMER_CSV_HEADER, ...rows]);
}
