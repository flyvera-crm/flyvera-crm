"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Customer, Lead, QuoteItemType, QuoteRecipient, Quotation } from "@/types/crm";
import { AGENTS } from "@/config/customer-options";
import { LOW_MARGIN_PERCENT, QUOTE_ITEM_TYPES } from "@/config/quote-options";
import {
  draftItemsForTotals,
  itemFieldId,
  newItem,
  nextItemId,
  nextQuoteId,
  parseAmount,
  QUOTE_NOTES_MAX,
  toQuotation,
  validateQuote,
  type QuoteFormValues,
  type QuoteItemDraft,
} from "@/lib/quote-validation";
import { lineTotal, quoteTotals } from "@/lib/quote-math";
import { quoteStore } from "@/lib/quote-store";
import { Card } from "@/components/ui/Card";
import { Field, fieldA11y, inputClass } from "@/components/ui/form";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/icons";
import { cn, formatMoney } from "@/lib/format";

/** Turns the "customer:CU-1001" / "lead:LD-2053" select value into a recipient snapshot. */
export function resolveRecipient(value: string, customers: Customer[], leads: Lead[]): QuoteRecipient | null {
  const [kind, id] = value.split(":");
  if (kind === "customer") {
    const c = customers.find((x) => x.id === id);
    return c ? { kind, id, name: c.name, email: c.email, phone: c.phone } : null;
  }
  if (kind === "lead") {
    const l = leads.find((x) => x.id === id);
    return l ? { kind, id, name: l.name, email: l.email, phone: l.phone } : null;
  }
  return null;
}

function SelectBox({ invalid, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select {...rest} className={inputClass(invalid, "h-11 appearance-none pr-9")}>
        {children}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
    </div>
  );
}

function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4 border-b border-navy-50 px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-semibold text-navy-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-navy-400">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </Card>
  );
}

export function QuoteBuilder({
  mode,
  existing,
  initialValues,
  customers,
  leads,
  allQuotes,
  today,
}: {
  mode: "add" | "edit";
  existing?: Quotation;
  initialValues: QuoteFormValues;
  customers: Customer[];
  leads: Lead[];
  allQuotes: Quotation[];
  today: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(initialValues);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { errors, warnings } = useMemo(() => validateQuote(values, today), [values, today]);
  const errorCount = Object.keys(errors).length;
  const totals = useMemo(() => {
    const d = parseAmount(values.discount);
    const t = parseAmount(values.taxRate);
    return quoteTotals(draftItemsForTotals(values.items), Number.isFinite(d) ? d : 0, Number.isFinite(t) ? t : 0);
  }, [values.items, values.discount, values.taxRate]);
  const quoteId = existing?.id ?? nextQuoteId(allQuotes);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const show = (id: string) => submitted || touched[id];
  const err = (id: string) => (show(id) ? errors[id] : undefined);
  const warn = (id: string) => (show(id) ? warnings[id] : undefined);
  const touch = (id: string) => () => setTouched((t) => (t[id] ? t : { ...t, [id]: true }));

  function update(patch: Partial<QuoteFormValues>) {
    setValues((v) => ({ ...v, ...patch }));
    setDirty(true);
  }

  type TextField = Exclude<keyof QuoteFormValues, "items">;
  function bind(field: TextField, hint?: string) {
    return {
      ...fieldA11y(field, { error: err(field), warning: warn(field), hint }),
      value: values[field],
      onChange: (e: { target: { value: string } }) => update({ [field]: e.target.value }),
      onBlur: touch(field),
      className: inputClass(!!err(field)),
    };
  }

  /* ── Line items ── */
  function updateItem(id: string, patch: Partial<QuoteItemDraft>) {
    setValues((v) => ({ ...v, items: v.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    setDirty(true);
  }
  function addItem(type: QuoteItemType) {
    const id = nextItemId(values.items);
    const travellers = String(Math.max(Number(values.adults) || 1, 1) + (Number(values.children) || 0));
    const qty = type === "Flight" || type === "Insurance" || type === "Visa" ? travellers : "1";
    update({ items: [...values.items, newItem(id, type, "", qty)] });
    setTimeout(() => document.getElementById(itemFieldId(id, "description"))?.focus(), 0);
  }
  function removeItem(id: string) {
    update({ items: values.items.filter((i) => i.id !== id) });
  }

  /* ── Recipient: picking someone fills in what we already know about them ── */
  function chooseRecipient(value: string) {
    const [kind, id] = value.split(":");
    const patch: Partial<QuoteFormValues> = { recipient: value };
    if (kind === "lead") {
      const l = leads.find((x) => x.id === id);
      if (l) {
        if (!values.agent) patch.agent = l.agent;
        if (!values.destination) patch.destination = l.destination;
        if (!values.title) patch.title = `${l.tripType} in ${l.destination}`;
        if (!values.departDate && l.departDate && l.departDate >= today) patch.departDate = l.departDate;
        if (!values.returnDate && l.returnDate && l.returnDate >= today) patch.returnDate = l.returnDate;
        if (mode === "add") patch.adults = String(l.travellers);
      }
    } else if (kind === "customer") {
      const c = customers.find((x) => x.id === id);
      if (c && !values.agent) patch.agent = c.agent;
    }
    update(patch);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (errorCount) {
      // Focus the first problem in page order (or the items area if there are no items).
      const form = formRef.current;
      const first = form && Array.from(form.elements).find((el) => (el as HTMLElement).id && errors[(el as HTMLElement).id]);
      if (first) (first as HTMLElement).focus();
      else document.getElementById("items-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const recipient = resolveRecipient(values.recipient, customers, leads);
    if (!recipient) return;
    const saved =
      mode === "edit" && existing
        ? toQuotation(values, recipient, existing, today)
        : toQuotation(values, recipient, { id: quoteId, created: today, status: "Draft" }, today);
    if (mode === "edit") quoteStore.update(saved); // ← later: API call
    else quoteStore.add(saved);
    setDirty(false);
    toast({
      message: (
        <p>
          {mode === "edit" ? "Changes saved to" : "Draft saved as"} <span className="font-mono text-gold-300">{saved.id}</span>.
        </p>
      ),
    });
    router.push(`/quotations/${saved.id}`);
  }

  function cancel() {
    if (dirty && !window.confirm("Leave without saving? Your changes will be lost.")) return;
    router.push(existing ? `/quotations/${existing.id}` : "/quotations");
  }

  const openLeads = leads.filter((l) => l.stage !== "Lost" && !l.customerId);
  const lowMargin = totals.taxable > 0 && totals.margin < LOW_MARGIN_PERCENT;

  const saveButton = (extra?: string) => (
    <button
      type="submit"
      form="quote-form"
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-800",
        extra,
      )}
    >
      <Icon name="check" size={16} className="text-gold-300" strokeWidth={2.5} />
      {mode === "edit" ? "Save changes" : "Save draft"}
    </button>
  );

  return (
    <form id="quote-form" ref={formRef} onSubmit={handleSubmit} noValidate className="pb-24 lg:pb-0">
      {submitted && errorCount > 0 && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700">
          <Icon name="alert" size={18} className="mt-px shrink-0" />
          <p>
            <span className="font-semibold">
              {errorCount} {errorCount === 1 ? "thing needs" : "things need"} attention
            </span>{" "}
            before this quotation can be saved.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ── Who & what ── */}
          <Section title="Customer & trip" description="Choose a customer or an open lead — known details are filled in for you.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="recipient" label="Quotation for" required error={err("recipient")} className="sm:col-span-2">
                <SelectBox
                  {...fieldA11y("recipient", { error: err("recipient") })}
                  value={values.recipient}
                  onChange={(e) => chooseRecipient(e.target.value)}
                  onBlur={touch("recipient")}
                  invalid={!!err("recipient")}
                >
                  <option value="">Choose a customer or lead…</option>
                  <optgroup label="Open leads">
                    {openLeads.map((l) => (
                      <option key={l.id} value={`lead:${l.id}`}>
                        {l.name} — {l.destination} ({l.id})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Customers">
                    {customers.map((c) => (
                      <option key={c.id} value={`customer:${c.id}`}>
                        {c.name} — {c.city} ({c.id})
                      </option>
                    ))}
                  </optgroup>
                </SelectBox>
              </Field>
              <Field id="title" label="Title" required error={err("title")}>
                <input {...bind("title")} placeholder="e.g. Bali honeymoon escape" />
              </Field>
              <Field id="destination" label="Destination" required error={err("destination")}>
                <input {...bind("destination")} placeholder="e.g. Bali, Indonesia" />
              </Field>
              <Field id="departDate" label="Departure" error={err("departDate")}>
                <input {...bind("departDate")} type="date" />
              </Field>
              <Field id="returnDate" label="Return" error={err("returnDate")}>
                <input {...bind("returnDate")} type="date" min={values.departDate || undefined} />
              </Field>
              <Field id="adults" label="Adults" required error={err("adults")}>
                <input {...bind("adults")} type="number" inputMode="numeric" min={1} step={1} />
              </Field>
              <Field id="children" label="Children" required error={err("children")}>
                <input {...bind("children")} type="number" inputMode="numeric" min={0} step={1} />
              </Field>
            </div>
          </Section>

          {/* ── Line items ── */}
          <div id="items-section">
            <Section
              title="Items"
              description="Prices are what the customer pays. Cost is your supplier cost — never shown on the quotation."
            >
              {values.items.length > 0 && (
                <div className="hidden grid-cols-[120px_minmax(0,1fr)_64px_104px_104px_96px_36px] gap-2 px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-navy-400 md:grid">
                  <span>Type</span>
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Unit price</span>
                  <span>Cost (total)</span>
                  <span className="text-right">Line total</span>
                  <span />
                </div>
              )}
              <ul className="space-y-3 md:space-y-2">
                {values.items.map((item, index) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    err={err}
                    warn={warn}
                    touch={touch}
                    onChange={(patch) => updateItem(item.id, patch)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
              </ul>
              {err("items") && (
                <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-rose-600">
                  <Icon name="alert" size={14} /> {err("items")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {QUOTE_ITEM_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => addItem(t.value)}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-navy-200 px-3 py-1.5 text-sm font-medium text-navy-600 transition hover:border-sky-brand hover:bg-sky-brand-light/40 hover:text-navy-900"
                  >
                    <Icon name="plus" size={14} className="text-sky-brand-dark" /> {t.value}
                  </button>
                ))}
              </div>
            </Section>
          </div>

          {/* ── Pricing & terms ── */}
          <Section title="Pricing & terms">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="discount" label="Discount (USD)" error={err("discount")}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy-400">$</span>
                  <input {...bind("discount")} inputMode="decimal" placeholder="0" className={inputClass(!!err("discount"), "h-11 pl-7")} />
                </div>
              </Field>
              <Field id="taxRate" label="Tax / service charge (%)" required error={err("taxRate")}>
                <input {...bind("taxRate")} inputMode="decimal" />
              </Field>
              <Field id="validUntil" label="Valid until" required error={err("validUntil")} warning={warn("validUntil")}>
                <input {...bind("validUntil")} type="date" min={today} />
              </Field>
              <Field id="agent" label="Prepared by" required error={err("agent")}>
                <SelectBox {...bind("agent")} invalid={!!err("agent")}>
                  <option value="">Choose an agent…</option>
                  {AGENTS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </SelectBox>
              </Field>
              <Field
                id="notes"
                label="Note to the customer"
                className="sm:col-span-2"
                error={err("notes")}
                hint={`Printed on the quotation · ${values.notes.length}/${QUOTE_NOTES_MAX}`}
              >
                <textarea
                  {...bind("notes", `Printed on the quotation · ${values.notes.length}/${QUOTE_NOTES_MAX}`)}
                  rows={3}
                  placeholder="e.g. Upgrade to a beachfront villa available for +$420."
                  className={inputClass(!!err("notes"), "min-h-24 resize-y py-2.5")}
                />
              </Field>
            </div>
          </Section>
        </div>

        {/* ── Live summary ── */}
        <aside className="space-y-4 lg:sticky lg:top-24">
          <Card className="overflow-hidden">
            <div className="bg-navy-900 px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-300">{mode === "edit" ? "Editing" : "New quotation"}</p>
              <p className="mt-0.5 font-mono text-lg">{quoteId}</p>
            </div>
            <dl className="space-y-2.5 p-5 text-sm">
              <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
              {totals.discount > 0 && <Row label="Discount" value={`− ${formatMoney(totals.discount)}`} />}
              {totals.tax > 0 && <Row label={`Tax (${values.taxRate}%)`} value={formatMoney(totals.tax)} />}
              <div className="flex items-baseline justify-between border-t border-navy-100 pt-3">
                <dt className="font-semibold text-navy-900">Total</dt>
                <dd className="text-2xl font-bold tracking-tight text-navy-900">{formatMoney(totals.total)}</dd>
              </div>
            </dl>
            {/* Internal-only profit box */}
            <div className={cn("mx-5 mb-5 rounded-xl border p-3.5 text-sm", lowMargin ? "border-amber-200 bg-amber-50" : "border-navy-100 bg-canvas")}>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-navy-400">
                <Icon name="wallet" size={13} /> Internal — not on the quotation
              </p>
              <dl className="mt-2 space-y-1.5">
                <Row label="Supplier cost" value={formatMoney(totals.cost)} />
                <Row label="Profit" value={formatMoney(totals.profit)} strong />
                <Row label="Margin" value={`${totals.margin.toFixed(1)}%`} strong />
              </dl>
              {lowMargin && (
                <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-700">
                  <Icon name="alert" size={13} className="mt-px shrink-0" /> Margin is below {LOW_MARGIN_PERCENT}%. Check prices or costs.
                </p>
              )}
            </div>
            <div className="hidden flex-col gap-2 border-t border-navy-50 p-5 lg:flex">
              {saveButton()}
              <button type="button" onClick={cancel} className="rounded-xl px-4 py-2 text-sm font-medium text-navy-500 hover:bg-navy-50">
                Cancel
              </button>
            </div>
          </Card>
          <p className="px-1 text-xs text-navy-400">
            Saved quotations start as <span className="font-semibold">Draft</span>. Review the printable version, then mark it as sent.
          </p>
        </aside>
      </div>

      {/* Phone/tablet: sticky bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-navy-100 bg-white/95 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <div>
          <p className="text-xs text-navy-400">Total</p>
          <p className="text-lg font-bold text-navy-900">{formatMoney(totals.total)}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={cancel} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700">
            Cancel
          </button>
          {saveButton()}
        </div>
      </div>
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-navy-500">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold text-navy-900" : "text-navy-700")}>{value}</dd>
    </div>
  );
}

function ItemRow({
  item,
  index,
  err,
  warn,
  touch,
  onChange,
  onRemove,
}: {
  item: QuoteItemDraft;
  index: number;
  err: (id: string) => string | undefined;
  warn: (id: string) => string | undefined;
  touch: (id: string) => () => void;
  onChange: (patch: Partial<QuoteItemDraft>) => void;
  onRemove: () => void;
}) {
  const placeholder = QUOTE_ITEM_TYPES.find((t) => t.value === item.type)?.placeholder;
  const ids = {
    type: `item-${item.id}-type`,
    description: itemFieldId(item.id, "description"),
    quantity: itemFieldId(item.id, "quantity"),
    unitPrice: itemFieldId(item.id, "unitPrice"),
    cost: itemFieldId(item.id, "cost"),
  };
  const [qty, price] = [parseAmount(item.quantity), parseAmount(item.unitPrice)];
  const total = Number.isFinite(qty) && Number.isFinite(price) ? lineTotal({ quantity: qty, unitPrice: price }) : 0;
  const messages = (["description", "quantity", "unitPrice", "cost"] as const)
    .map((f) => ({ f, text: err(ids[f]) ?? warn(ids[f]), isError: !!err(ids[f]) }))
    .filter((m) => m.text);

  const input = (field: "description" | "quantity" | "unitPrice" | "cost", extra: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      id={ids[field]}
      name={ids[field]}
      value={item[field]}
      onChange={(e) => onChange({ [field]: e.target.value })}
      onBlur={touch(ids[field])}
      aria-invalid={err(ids[field]) ? true : undefined}
      aria-describedby={err(ids[field]) || warn(ids[field]) ? `${item.id}-messages` : undefined}
      className={inputClass(!!err(ids[field]), cn("h-10", field !== "description" && "tabular-nums"))}
      {...extra}
    />
  );

  return (
    <li className="rounded-xl border border-navy-100 p-3 md:rounded-none md:border-0 md:p-0">
      <div className="grid grid-cols-6 gap-2 md:grid-cols-[120px_minmax(0,1fr)_64px_104px_104px_96px_36px] md:items-center">
        <label className="col-span-3 md:col-span-1">
          <span className="mb-1 block text-xs text-navy-400 md:sr-only">Type of item {index + 1}</span>
          <div className="relative">
            <select
              id={ids.type}
              value={item.type}
              onChange={(e) => onChange({ type: e.target.value as QuoteItemType })}
              className={inputClass(false, "h-10 appearance-none pr-7")}
            >
              {QUOTE_ITEM_TYPES.map((t) => (
                <option key={t.value}>{t.value}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-navy-400" />
          </div>
        </label>
        <div className="col-span-3 flex items-end justify-end md:hidden">
          <button type="button" onClick={onRemove} className="rounded-lg px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50">
            Remove
          </button>
        </div>
        <label className="col-span-6 md:col-span-1">
          <span className="mb-1 block text-xs text-navy-400 md:sr-only">Description</span>
          {input("description", { placeholder })}
        </label>
        <label className="col-span-2 md:col-span-1">
          <span className="mb-1 block text-xs text-navy-400 md:sr-only">Qty</span>
          {input("quantity", { inputMode: "numeric" })}
        </label>
        <label className="col-span-2 md:col-span-1">
          <span className="mb-1 block text-xs text-navy-400 md:sr-only">Unit price $</span>
          {input("unitPrice", { inputMode: "decimal", placeholder: "Price" })}
        </label>
        <label className="col-span-2 md:col-span-1">
          <span className="mb-1 block text-xs text-navy-400 md:sr-only">Cost (total) $</span>
          {input("cost", { inputMode: "decimal", placeholder: "optional" })}
        </label>
        <p className="col-span-6 text-right text-sm font-semibold tabular-nums text-navy-900 md:col-span-1">
          <span className="mr-2 text-xs font-normal text-navy-400 md:hidden">Line total</span>
          {formatMoney(total)}
        </p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove item ${index + 1}`}
          className="hidden size-9 place-items-center rounded-lg text-navy-300 hover:bg-rose-50 hover:text-rose-600 md:grid"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      {messages.length > 0 && (
        <ul id={`${item.id}-messages`} className="mt-1.5 space-y-0.5 md:pl-[128px]">
          {messages.map((m) => (
            <li key={m.f} className={cn("flex items-center gap-1.5 text-xs font-medium", m.isError ? "text-rose-600" : "text-amber-700")}>
              <Icon name="alert" size={12} />
              {m.f === "unitPrice" ? "Price" : m.f === "quantity" ? "Qty" : m.f === "cost" ? "Cost" : "Description"}: {m.text}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
