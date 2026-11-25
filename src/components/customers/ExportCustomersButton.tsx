"use client";

import { Icon } from "@/components/icons";
import { customersCsv } from "@/lib/customer-export";
import { downloadText } from "@/lib/download";
import { todayIso } from "@/lib/dates";
import { useCustomers } from "./CustomersProvider";

/** Admins only (decided on the server): downloads the customers this user can see as CSV. */
export function ExportCustomersButton() {
  const { customers } = useCustomers();
  return (
    <button
      type="button"
      onClick={() => downloadText(`flyvera-customers-${todayIso()}.csv`, customersCsv(customers))}
      disabled={!customers.length}
      title="Contact details and trip figures. Passports, dates of birth and notes aren't included."
      className="flex items-center gap-2 rounded-xl border border-navy-100 bg-white px-4 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50 disabled:opacity-50"
    >
      <Icon name="document" size={16} /> Export CSV
    </button>
  );
}
