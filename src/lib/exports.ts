// CSV exports for Payments and Invoices, and the supplier filter for supplier payments (pure, unit-tested).
// The shared builder (toCsv) keeps every cell spreadsheet-safe. In the UI these exports are for admins
// and Finance only (bulk financial data).
import type { Invoice, InvoiceStatus } from "@/types/invoices";
import type { LedgerEntry, Payable } from "@/lib/payment-ledger";
import { toCsv } from "@/lib/report-metrics";

export function paymentsCsv(entries: LedgerEntry[]) {
  const header = ["Date", "Receipt", "Type", "Booking", "Customer", "Method", "Amount", "Reference", "Note"];
  const rows = entries.map((e) => [
    e.payment.date,
    e.receiptNo,
    e.payment.kind === "refund" ? "Refund" : "Payment",
    e.booking.id,
    e.booking.customerName,
    e.payment.method,
    e.signedAmount,
    e.payment.reference ?? "",
    e.payment.note ?? "",
  ]);
  return toCsv([header, ...rows]);
}

export function invoicesCsv(rows: { inv: Invoice; status: InvoiceStatus; balance: number }[]) {
  const header = ["Invoice", "Status", "Issued", "Due", "Customer", "Customer code", "Booking", "Currency", "Total", "Paid", "Balance"];
  const out = rows.map(({ inv, status, balance }) => [
    inv.number ?? "Draft",
    status,
    inv.issueOn ?? "",
    inv.dueOn ?? "",
    inv.billTo.name,
    inv.customerCode,
    inv.bookingCode,
    inv.currency,
    inv.total,
    status === "Draft" || status === "Void" ? "" : inv.paid,
    status === "Draft" || status === "Void" ? "" : balance,
  ]);
  return toCsv([header, ...out]);
}

/** Supplier filter: "" = everyone, "none" = services not linked to a supplier yet, otherwise a supplier id. */
export function filterBySupplier(payables: Payable[], supplier: string) {
  if (!supplier) return payables;
  if (supplier === "none") return payables.filter((p) => !p.service.supplierId);
  return payables.filter((p) => p.service.supplierId === supplier);
}

/** Suppliers that appear in the list, for the filter (name order). */
export function payableSuppliers(payables: Payable[]) {
  const seen = new Map<string, string>();
  for (const p of payables) if (p.service.supplierId && p.service.supplierName) seen.set(p.service.supplierId, p.service.supplierName);
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
