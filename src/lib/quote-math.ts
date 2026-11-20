// All quotation money maths in one place. Amounts are rounded to cents.
import type { QuoteItem } from "@/types/crm";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function lineTotal(item: Pick<QuoteItem, "quantity" | "unitPrice">) {
  return round2(item.quantity * item.unitPrice);
}

export type QuoteTotals = {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  cost: number;
  profit: number; // before tax
  margin: number; // profit as % of (subtotal − discount), 1 decimal
};

export function quoteTotals(items: Pick<QuoteItem, "quantity" | "unitPrice" | "cost">[], discount: number, taxRate: number): QuoteTotals {
  const subtotal = round2(items.reduce((s, i) => s + lineTotal(i), 0));
  const d = round2(Math.min(Math.max(discount, 0), subtotal));
  const taxable = round2(subtotal - d);
  const tax = round2((taxable * taxRate) / 100);
  const cost = round2(items.reduce((s, i) => s + (i.cost || 0), 0));
  const profit = round2(taxable - cost);
  return {
    subtotal,
    discount: d,
    taxable,
    tax,
    total: round2(taxable + tax),
    cost,
    profit,
    // Round once, straight to 1 decimal (rounding to 2 first would turn 10.952 → 10.95 → "10.9").
    margin: taxable > 0 ? Math.round((profit / taxable) * 1000) / 10 : 0,
  };
}
