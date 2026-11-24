"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Customer, CustomerStatus, CustomerTier } from "@/types/crm";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/icons";
import { cn, formatCurrency, formatDate, initials } from "@/lib/format";
import { fold, matchesSearch } from "@/lib/customer-search";
import { useCustomers } from "./CustomersProvider";

const PAGE_SIZE = 10;
const TIERS: Array<CustomerTier | "All"> = ["All", "Platinum", "Gold", "Silver", "Standard"];
const STATUSES: Array<CustomerStatus | "All"> = ["All", "Active", "Travelling", "Inactive"];

const tierTone: Record<CustomerTier, BadgeTone> = {
  Platinum: "premium",
  Gold: "gold",
  Silver: "neutral",
  Standard: "info",
};

const statusTone: Record<CustomerStatus, BadgeTone> = {
  Active: "success",
  Travelling: "info",
  Inactive: "neutral",
};

type SortKey = "name" | "trips" | "lifetimeValue" | "lastTrip";
type Sort = { key: SortKey; dir: "asc" | "desc" };

function compare(a: Customer, b: Customer, { key, dir }: Sort) {
  let r: number;
  if (key === "name") r = a.name.localeCompare(b.name);
  else if (key === "lastTrip") r = (a.lastTrip ?? "").localeCompare(b.lastTrip ?? "");
  else r = a[key] - b[key];
  return dir === "asc" ? r : -r;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = fold(query.trim());
  if (!q) return <>{text}</>;
  const hay = fold(text);
  // Highlight the whole query if it appears, otherwise the first word that does.
  const needle = [q, ...q.split(/\s+/)].find((w) => w && hay.includes(w));
  if (!needle) return <>{text}</>;
  const i = hay.indexOf(needle);
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-gold-100 px-0.5 text-navy-900">{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

function Avatar({ name, tier }: { name: string; tier: CustomerTier }) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
        tier === "Platinum" ? "bg-navy-900 text-gold-300 ring-2 ring-gold-500/50" : "bg-navy-50 text-navy-700",
      )}
    >
      {initials(name)}
    </span>
  );
}

function SortHeader({
  k,
  label,
  align = "left",
  className,
  sort,
  onSort,
}: {
  k: SortKey;
  label: string;
  align?: "left" | "right";
  className?: string;
  sort: Sort;
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-3 first:pl-6", align === "right" && "text-right", className)}
    >
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-wider hover:text-navy-900",
          active && "text-navy-900",
        )}
      >
        {label}
        <Icon
          name={active && sort.dir === "asc" ? "arrowUp" : "arrowDown"}
          size={12}
          strokeWidth={2.5}
          className={active ? "text-sky-brand-dark" : "opacity-30"}
        />
      </button>
    </th>
  );
}

export function CustomersTable() {
  const { customers, addedIds, onCustomerAdded } = useCustomers();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<CustomerTier | "All">("All");
  const [status, setStatus] = useState<CustomerStatus | "All">("All");
  const [sort, setSort] = useState<Sort>({ key: "lifetimeValue", dir: "desc" });
  const [page, setPage] = useState(1);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // When a customer is added: clear filters, jump to the page it's on, and highlight it.
  useEffect(
    () =>
      onCustomerAdded((customer, all) => {
        setQuery("");
        setTier("All");
        setStatus("All");
        const index = [...all].sort((a, b) => compare(a, b, sort)).findIndex((c) => c.id === customer.id);
        setPage(Math.floor(Math.max(index, 0) / PAGE_SIZE) + 1);
        setHighlightId(customer.id);
        setTimeout(() => setHighlightId((id) => (id === customer.id ? null : id)), 4000);
      }),
    [onCustomerAdded, sort],
  );

  // Press "/" anywhere on the page to jump to the search box.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
        !target.closest('[role="dialog"]')
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(
    () =>
      customers
        .filter((c) => (tier === "All" || c.tier === tier) && (status === "All" || c.status === status))
        .filter((c) => matchesSearch(c, query))
        .sort((a, b) => compare(a, b, sort)),
    [customers, query, tier, status, sort],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const from = filtered.length ? (current - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(current * PAGE_SIZE, filtered.length);
  const hasFilters = query !== "" || tier !== "All" || status !== "All";

  // Any change to search/filters/sort goes back to page 1.
  function update(fn: () => void) {
    fn();
    setPage(1);
  }

  function toggleSort(key: SortKey) {
    update(() =>
      setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" })),
    );
  }

  function clearAll() {
    update(() => {
      setQuery("");
      setTier("All");
      setStatus("All");
    });
  }

  const sortProps = { sort, onSort: toggleSort };

  return (
    <div>
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-b border-navy-50 p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
        <label className="relative block w-full min-w-0 xl:max-w-sm xl:flex-1">
          <span className="sr-only">Search customers</span>
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => update(() => setQuery(e.target.value))}
            placeholder="Search name, email, phone, city…"
            className="h-11 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-16 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
          />
          {query ? (
            <button
              onClick={() => update(() => setQuery(""))}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-navy-400 hover:bg-navy-50 hover:text-navy-700"
              aria-label="Clear search"
            >
              <Icon name="close" size={16} />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-navy-100 bg-white px-1.5 text-xs text-navy-400 sm:block">
              /
            </kbd>
          )}
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:shrink-0">
          <div className="flex flex-wrap gap-1 sm:flex-nowrap" role="group" aria-label="Filter by tier">
            {TIERS.map((t) => (
              <button
                key={t}
                onClick={() => update(() => setTier(t))}
                aria-pressed={tier === t}
                className={cn(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  tier === t ? "bg-navy-900 text-white shadow-sm" : "text-navy-500 hover:bg-navy-50 hover:text-navy-900",
                )}
              >
                {t === "Platinum" && <Icon name="crown" size={13} className="mr-1 inline -translate-y-px text-gold-400" />}
                {t}
              </button>
            ))}
          </div>

          <label className="relative">
            <span className="sr-only">Filter by status</span>
            <select
              value={status}
              onChange={(e) => update(() => setStatus(e.target.value as CustomerStatus | "All"))}
              className="h-10 w-full appearance-none rounded-xl border border-navy-100 bg-white pl-3 pr-9 text-sm font-medium text-navy-700 focus:border-sky-brand focus:outline-none focus:ring-4 focus:ring-sky-brand/15 sm:w-auto"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "All" ? "All statuses" : s}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
          </label>
        </div>
      </div>

      {/* Result count (announced to screen readers when it changes) */}
      <div className="flex items-center justify-between px-4 py-3 text-sm sm:px-6" aria-live="polite">
        <p className="text-navy-500">
          {filtered.length === customers.length ? (
            <>
              <span className="font-semibold text-navy-900">{customers.length}</span> customers
            </>
          ) : (
            <>
              <span className="font-semibold text-navy-900">{filtered.length}</span> of {customers.length} customers match
            </>
          )}
        </p>
        <div className="flex items-center gap-4">
          {hasFilters && (
            <button onClick={clearAll} className="font-medium text-sky-brand-dark hover:text-navy-900">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        /* ── Empty state ───────────────────────────────────── */
        <div className="flex flex-col items-center border-t border-navy-50 px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-400">
            <Icon name="search" size={24} />
          </div>
          <p className="mt-4 font-semibold text-navy-900">No customers found</p>
          <p className="mt-1 max-w-sm text-sm text-navy-400">
            {query ? <>Nothing matches “{query}”. </> : null}Try a different search or clear the filters.
          </p>
          <button
            onClick={clearAll}
            className="mt-5 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {/* ── Mobile: cards ───────────────────────────────── */}
          <ul className="divide-y divide-navy-50 border-t border-navy-50 md:hidden">
            {rows.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "relative px-4 py-4 transition-colors duration-700 active:bg-sky-brand-light/40",
                  c.id === highlightId && "bg-gold-50",
                )}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={c.name} tier={c.tier} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-semibold text-navy-900">
                        {/* the link's ::after covers the whole card, so tapping anywhere opens the profile */}
                        <Link href={`/customers/${c.id}`} className="after:absolute after:inset-0">
                          <Highlight text={c.name} query={query} />
                        </Link>
                        {addedIds.has(c.id) && <NewTag />}
                      </p>
                      <Badge tone={tierTone[c.tier]}>{c.tier}</Badge>
                    </div>
                    <p className="truncate text-sm text-navy-500">
                      <Highlight text={c.email} query={query} />
                    </p>
                    <p className="text-xs text-navy-400">
                      {c.phone} · {c.city}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-navy-500">
                      <Badge tone={statusTone[c.status]}>{c.status}</Badge>
                      {!c.statsHidden && (
                        <>
                          <span>
                            <span className="font-semibold text-navy-900">{c.trips}</span> trips
                          </span>
                          <span className="font-semibold text-navy-900">{formatCurrency(c.lifetimeValue)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* ── Tablet & desktop: table ─────────────────────── */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Customers</caption>
              <thead>
                <tr className="border-y border-navy-50 bg-canvas/60 text-left text-xs font-semibold text-navy-400">
                  <SortHeader {...sortProps} k="name" label="Customer" />
                  <th scope="col" className="hidden px-3 py-3 uppercase tracking-wider 2xl:table-cell">
                    Contact
                  </th>
                  <th scope="col" className="px-3 py-3 uppercase tracking-wider">
                    Tier
                  </th>
                  <th scope="col" className="px-3 py-3 uppercase tracking-wider">
                    Status
                  </th>
                  <SortHeader {...sortProps} k="trips" label="Trips" align="right" className="hidden xl:table-cell" />
                  <SortHeader {...sortProps} k="lifetimeValue" label="Lifetime value" align="right" className="pr-6 xl:pr-3" />
                  <SortHeader {...sortProps} k="lastTrip" label="Last trip" className="hidden xl:table-cell" />
                  <th scope="col" className="hidden px-3 py-3 pr-6 uppercase tracking-wider xl:table-cell">
                    Agent
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    // Clicking anywhere on the row opens the profile; the name link handles keyboard users.
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest("a")) router.push(`/customers/${c.id}`);
                    }}
                    className={cn(
                      "group cursor-pointer transition-colors duration-700",
                      c.id === highlightId ? "bg-gold-50" : "hover:bg-sky-brand-light/40",
                    )}
                  >
                    <td className="py-3.5 pl-6 pr-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} tier={c.tier} />
                        <div className="min-w-0 leading-tight">
                          <p className="whitespace-nowrap font-medium text-navy-900">
                            <Link
                              href={`/customers/${c.id}`}
                              className="rounded group-hover:text-sky-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-brand"
                            >
                              <Highlight text={c.name} query={query} />
                            </Link>
                            {addedIds.has(c.id) && <NewTag />}
                          </p>
                          {/* Below 2xl the Contact column is hidden, so show the email here instead */}
                          <p className="whitespace-nowrap text-xs text-navy-500 2xl:hidden">
                            <Highlight text={c.email} query={query} />
                          </p>
                          <p className="whitespace-nowrap text-xs text-navy-400">
                            <span className="font-mono">{c.id}</span> · <Highlight text={c.city} query={query} />
                            <span className="hidden 2xl:inline">, {c.country}</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3.5 leading-tight 2xl:table-cell">
                      <p className="whitespace-nowrap text-navy-700">
                        <Highlight text={c.email} query={query} />
                      </p>
                      <p className="whitespace-nowrap text-xs text-navy-400">{c.phone}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      <Badge tone={tierTone[c.tier]}>{c.tier}</Badge>
                    </td>
                    <td className="px-3 py-3.5">
                      <Badge tone={statusTone[c.status]}>{c.status}</Badge>
                    </td>
                    <td className="hidden px-3 py-3.5 text-right xl:table-cell tabular-nums text-navy-700">
                      {c.statsHidden ? <span className="text-navy-300">—</span> : c.trips}
                    </td>
                    <td className="whitespace-nowrap py-3.5 pl-3 pr-6 text-right xl:pr-3 font-semibold tabular-nums text-navy-900">
                      {c.statsHidden ? <span className="font-normal text-navy-300">—</span> : formatCurrency(c.lifetimeValue)}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3.5 leading-tight xl:table-cell">
                      {c.statsHidden ? (
                        <span className="text-navy-300">—</span>
                      ) : c.lastTrip ? (
                        <>
                          <p className="text-navy-700">{formatDate(c.lastTrip)}</p>
                          {c.favouriteDestination && <p className="text-xs text-navy-400">Loves {c.favouriteDestination}</p>}
                        </>
                      ) : (
                        <span className="text-navy-300">No trips yet</span>
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3.5 pr-6 text-navy-600 xl:table-cell">{c.agent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ──────────────────────────────────── */}
          <nav
            className="flex items-center justify-between gap-3 border-t border-navy-50 px-4 py-3 text-sm sm:px-6"
            aria-label="Pagination"
          >
            <p className="text-navy-500">
              Showing <span className="font-medium text-navy-900">{from}</span>–<span className="font-medium text-navy-900">{to}</span> of{" "}
              <span className="font-medium text-navy-900">{filtered.length}</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(current - 1)}
                disabled={current === 1}
                className="rounded-lg border border-navy-100 px-3 py-1.5 font-medium text-navy-700 hover:bg-navy-50 disabled:pointer-events-none disabled:opacity-40"
              >
                Previous
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  aria-current={p === current ? "page" : undefined}
                  className={cn(
                    "hidden size-8 rounded-lg font-medium sm:block",
                    p === current ? "bg-navy-900 text-white" : "text-navy-600 hover:bg-navy-50",
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(current + 1)}
                disabled={current === pageCount}
                className="rounded-lg border border-navy-100 px-3 py-1.5 font-medium text-navy-700 hover:bg-navy-50 disabled:pointer-events-none disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

function NewTag() {
  return (
    <span className="ml-1.5 rounded-md bg-gold-500 px-1.5 py-px align-middle text-[10px] font-bold uppercase tracking-wide text-navy-950">
      New
    </span>
  );
}
