// "Saved searches": the flight search requests agents saved from "Describe the trip", newest first.
// Read-only. Nothing here is a fare, availability, allowance, PNR or ticket: the searches were never sent
// to a supplier, and baggage / fare conditions are only what the customer asked for.
import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatDate } from "@/lib/format";
import type { SavedSearch } from "@/lib/saved-searches";

export function SavedSearches({ searches, more, limit }: { searches: SavedSearch[]; more: boolean; limit: number }) {
  return (
    <Card>
      <CardHeader
        title="Saved searches"
        subtitle={`Search requests saved from "Describe the trip", newest first${more ? ` (latest ${limit} shown)` : ""}. Not searched: no flight supplier is connected yet.`}
      />
      <div className="p-5 sm:p-6">
        {searches.length === 0 ? (
          <p className="text-sm text-navy-500" data-testid="no-saved-searches">
            No saved searches yet. Describe a trip above, review the details and save it: it will be listed here.
          </p>
        ) : (
          <ul className="divide-y divide-navy-100 rounded-xl border border-navy-100" aria-label="Saved searches">
            {searches.map((s) => (
              <li key={s.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-navy-50/60 [&::-webkit-details-marker]:hidden">
                    <span className="font-mono text-sm font-semibold text-navy-900">{route(s)}</span>
                    <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-600">{s.tripType}</span>
                    <span className="text-sm text-navy-600">{dates(s)}</span>
                    <span className="text-sm text-navy-500">
                      {s.passengers} · {s.cabin}
                    </span>
                    <span className="ml-auto text-xs text-navy-400">
                      {s.savedBy} · {formatDate(s.savedAt)}
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-navy-100 bg-navy-50/30 px-4 py-4 text-sm">
                    {s.flights.length > 1 && (
                      <ol className="space-y-1" aria-label="Flights">
                        {s.flights.map((f, i) => (
                          <li key={i} className="text-navy-700">
                            Flight {i + 1}: <span className="font-mono">{f.origin} → {f.destination}</span> on {formatDate(f.departOn)}
                          </li>
                        ))}
                      </ol>
                    )}
                    <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
                      {s.flexibleDays !== null && <Item label="Date flexibility" value={s.flexibleDays === 0 ? "Exact dates" : `± ${s.flexibleDays} days`} />}
                      {s.details.map((d) => (
                        <Item key={d.label} label={d.label} value={d.value} />
                      ))}
                      <Item label="Linked to" value={s.link ? <LinkedTo link={s.link} /> : "Not linked"} />
                      {s.typedRequest && <Item label="Typed request" value={<q className="italic">{s.typedRequest}</q>} />}
                    </dl>
                    {s.notes.length > 0 && <List title="Other requests" items={s.notes} />}
                    {s.openQuestions.length > 0 && <List title="Open questions when saved" items={s.openQuestions} />}
                    <p className="text-xs text-navy-400">
                      {s.searched ? "Searched with a supplier." : "Not searched: no fares or availability."} Baggage and fare conditions are the customer&apos;s requests, not confirmed allowances or rules.
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function route(s: SavedSearch) {
  if (s.tripType === "Multi-city") return s.flights.map((f) => `${f.origin} → ${f.destination}`).join(", ");
  return `${s.flights[0].origin} ${s.tripType === "Return" ? "⇄" : "→"} ${s.flights[0].destination}`;
}

function dates(s: SavedSearch) {
  const first = formatDate(s.flights[0].departOn);
  if (s.tripType === "Return" && s.returnOn) return `${first} – ${formatDate(s.returnOn)}`;
  if (s.tripType === "Multi-city") return `${first} – ${formatDate(s.flights[s.flights.length - 1].departOn)}`;
  return first;
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="font-medium text-navy-500">{label}</dt>
      <dd className="text-navy-800">{value}</dd>
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-medium text-navy-500">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-navy-700">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function LinkedTo({ link }: { link: NonNullable<SavedSearch["link"]> }) {
  if (link.kind === "hidden") return <span className="text-navy-500">A lead or customer you can&apos;t view</span>;
  if (link.kind === "customer") {
    return (
      <Link href={`/customers/${link.code}`} className="font-medium text-navy-900 underline-offset-2 hover:underline">
        Customer {link.code} · {link.name}
      </Link>
    );
  }
  return (
    <span>
      Lead {link.code} · {link.name}
    </span>
  );
}
