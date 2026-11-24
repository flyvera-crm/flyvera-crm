import type { letterhead } from "@/lib/settings-rules";

type Head = ReturnType<typeof letterhead>;

/** Agency name and details at the top of quotations, invoices and receipts (only lines that are filled in). */
export function Letterhead({ head, subtitle }: { head: Head; subtitle: string }) {
  return (
    <div>
      <p className="text-2xl font-bold tracking-[0.2em]">{head.name}</p>
      <p className="text-xs font-medium uppercase tracking-wider text-gold-300">{subtitle}</p>
      {(head.legalName || head.lines.length > 0) && (
        <div className="mt-3 space-y-0.5 text-xs text-navy-200">
          {head.legalName && <p className="font-medium text-white/90">{head.legalName}</p>}
          {head.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bank details and payment note on invoices. */
export function PaymentDetails({ head }: { head: Head }) {
  if (!head.bank.length && !head.paymentNote) return null;
  return (
    <div className="rounded-xl bg-navy-50/60 px-4 py-3 text-xs text-navy-700 print:bg-navy-50">
      <p className="mb-1 font-semibold uppercase tracking-wider text-navy-400">How to pay</p>
      {head.bank.map((l) => (
        <p key={l} className="font-mono">
          {l}
        </p>
      ))}
      {head.paymentNote && <p className="mt-1">{head.paymentNote}</p>}
    </div>
  );
}
