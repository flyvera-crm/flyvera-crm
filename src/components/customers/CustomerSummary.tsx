"use client";

import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";
import { formatCurrency } from "@/lib/format";
import { useCustomers } from "./CustomersProvider";

function Summary({ label, value, hint, icon, gold }: { label: string; value: string; hint: string; icon: IconName; gold?: boolean }) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div
        className={
          gold
            ? "grid size-11 shrink-0 place-items-center rounded-xl bg-navy-900 text-gold-300"
            : "grid size-11 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700"
        }
      >
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-navy-500">{label}</p>
        <p className="text-xl font-semibold tracking-tight text-navy-900">{value}</p>
        <p className="truncate text-xs text-navy-400">{hint}</p>
      </div>
    </Card>
  );
}

// Client component so the numbers update the moment a customer is added.
export function CustomerSummary() {
  const { customers, addedIds } = useCustomers();
  const vip = customers.filter((c) => c.tier === "Platinum" || c.tier === "Gold").length;
  const travelling = customers.filter((c) => c.status === "Travelling").length;
  const totalValue = customers.reduce((sum, c) => sum + c.lifetimeValue, 0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Summary
        label="Total customers"
        value={String(customers.length)}
        hint={addedIds.size ? `Including ${addedIds.size} added by you` : "All traveller profiles"}
        icon="users"
      />
      <Summary label="VIP customers" value={String(vip)} hint="Platinum & Gold tiers" icon="crown" gold />
      <Summary label="Travelling now" value={String(travelling)} hint="Currently on a trip" icon="plane" />
      <Summary
        label="Lifetime value"
        value={formatCurrency(totalValue, { compact: true })}
        hint={`Avg ${formatCurrency(totalValue / customers.length)} per customer`}
        icon="wallet"
      />
    </div>
  );
}
