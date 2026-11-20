import type { Quotation } from "@/types/crm";
import { QUOTE_ITEM_TYPES, QUOTE_TERMS } from "@/config/quote-options";
import { siteConfig } from "@/config/site";
import { lineTotal, quoteTotals } from "@/lib/quote-math";
import { Icon } from "@/components/icons";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * The customer-facing quotation — what gets printed / saved as PDF.
 * Shows selling prices only (never your costs or margin).
 */
export function QuoteDocument({ quote: q }: { quote: Quotation }) {
  const t = quoteTotals(q.items, q.discount, q.taxRate);
  const nights = q.departDate && q.returnDate ? Math.round((Date.parse(q.returnDate) - Date.parse(q.departDate)) / 86_400_000) : null;
  const travellers = [
    `${q.adults} ${q.adults === 1 ? "adult" : "adults"}`,
    q.children ? `${q.children} ${q.children === 1 ? "child" : "children"}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
      {/* Letterhead */}
      <header className="relative overflow-hidden bg-navy-900 px-6 py-6 text-white sm:px-10 sm:py-8 print:bg-navy-900">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_140%_at_100%_0%,rgba(14,165,233,0.3),transparent_60%)]" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-2xl font-bold tracking-[0.2em]">{siteConfig.name}</p>
            <p className="text-xs font-medium uppercase tracking-wider text-gold-300">Travel quotation</p>
          </div>
          <div className="sm:text-right">
            <p className="font-mono text-lg">{q.id}</p>
            <p className="text-sm text-navy-200">Issued {formatDate(q.sentAt ?? q.updated)}</p>
            <p className="text-sm text-gold-300">Valid until {formatDate(q.validUntil)}</p>
          </div>
        </div>
      </header>

      <div className="space-y-8 px-6 py-6 sm:px-10 sm:py-8">
        {/* Prepared for + trip */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-400">Prepared for</p>
            <p className="mt-1 text-lg font-semibold text-navy-900">{q.recipient.name}</p>
            {q.recipient.email && <p className="text-sm text-navy-600">{q.recipient.email}</p>}
            <p className="text-sm text-navy-600">{q.recipient.phone}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-400">Your trip</p>
            <p className="mt-1 text-lg font-semibold text-navy-900">{q.title}</p>
            <p className="flex items-center gap-1.5 text-sm text-navy-600">
              <Icon name="plane" size={14} className="text-sky-brand-dark" /> {q.destination}
            </p>
            <p className="text-sm text-navy-600">
              {q.departDate ? (
                <>
                  {formatDate(q.departDate)}
                  {q.returnDate && <> – {formatDate(q.returnDate)}</>}
                  {nights !== null && <> · {nights} nights</>}
                </>
              ) : (
                "Flexible dates"
              )}{" "}
              · {travellers}
            </p>
          </div>
        </div>

        {/* Items */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-navy-900 text-left text-xs font-semibold uppercase tracking-wider text-navy-500">
              <th className="pb-2 pr-3">Item</th>
              <th className="hidden pb-2 pr-3 text-right sm:table-cell print:table-cell">Qty</th>
              <th className="hidden pb-2 pr-3 text-right sm:table-cell print:table-cell">Unit price</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {q.items.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="py-3 pr-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-brand-dark">
                    <Icon name={QUOTE_ITEM_TYPES.find((x) => x.value === i.type)?.icon ?? "plus"} size={12} />
                    {i.type}
                  </p>
                  <p className="mt-0.5 text-navy-900">{i.description}</p>
                  <p className="text-xs text-navy-400 sm:hidden print:hidden">
                    {i.quantity} × {formatMoney(i.unitPrice)}
                  </p>
                </td>
                <td className="hidden py-3 pr-3 text-right tabular-nums text-navy-600 sm:table-cell print:table-cell">{i.quantity}</td>
                <td className="hidden py-3 pr-3 text-right tabular-nums text-navy-600 sm:table-cell print:table-cell">
                  {formatMoney(i.unitPrice)}
                </td>
                <td className="py-3 text-right font-medium tabular-nums text-navy-900">{formatMoney(lineTotal(i))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <dl className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-navy-500">Subtotal</dt>
              <dd className="tabular-nums text-navy-800">{formatMoney(t.subtotal)}</dd>
            </div>
            {t.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-navy-500">Discount</dt>
                <dd className="tabular-nums text-emerald-700">− {formatMoney(t.discount)}</dd>
              </div>
            )}
            {t.tax > 0 && (
              <div className="flex justify-between">
                <dt className="text-navy-500">Tax ({q.taxRate}%)</dt>
                <dd className="tabular-nums text-navy-800">{formatMoney(t.tax)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between rounded-xl bg-navy-900 px-4 py-3 text-white print:bg-navy-900">
              <dt className="font-semibold">Total</dt>
              <dd className="text-xl font-bold tabular-nums text-gold-300">{formatMoney(t.total)}</dd>
            </div>
            <p className="text-right text-xs text-navy-400">
              ≈ {formatMoney(t.total / Math.max(q.adults + q.children, 1))} per traveller
            </p>
          </dl>
        </div>

        {q.notes && (
          <div className="rounded-xl border-l-4 border-gold-500 bg-gold-50/60 px-4 py-3 text-sm leading-relaxed text-navy-700 print:bg-gold-50">
            {q.notes}
          </div>
        )}

        {/* Terms + sign-off */}
        <footer className="grid grid-cols-1 gap-6 border-t border-navy-100 pt-6 text-xs text-navy-500 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="mb-1.5 font-semibold uppercase tracking-wider text-navy-400">Terms</p>
            <ul className="list-disc space-y-1 pl-4">
              {QUOTE_TERMS.map((term) => (
                <li key={term}>{term}</li>
              ))}
            </ul>
          </div>
          <div className="sm:text-right">
            <p className="font-semibold uppercase tracking-wider text-navy-400">Your travel consultant</p>
            <p className="mt-1 text-sm font-semibold text-navy-900">{q.agent}</p>
            <p>{siteConfig.product}</p>
          </div>
        </footer>
      </div>
    </article>
  );
}
