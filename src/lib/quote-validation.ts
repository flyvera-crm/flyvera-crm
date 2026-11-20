// Pure validation + conversion for the quotation builder (no React / browser APIs),
// so the same rules can later run on a server.
import type { QuoteItem, QuoteItemType, QuoteRecipient, Quotation } from "@/types/crm";
import { addDays } from "@/lib/customer-history";
import { DEFAULT_TAX_RATE, DEFAULT_VALIDITY_DAYS } from "@/config/quote-options";
import { lineTotal } from "@/lib/quote-math";

export type QuoteItemDraft = {
  id: string;
  type: QuoteItemType;
  description: string;
  quantity: string; // text while typing
  unitPrice: string;
  cost: string;
};

export type QuoteFormValues = {
  recipient: string; // "customer:CU-1001" or "lead:LD-2053"
  title: string;
  destination: string;
  departDate: string;
  returnDate: string;
  adults: string;
  children: string;
  items: QuoteItemDraft[];
  discount: string;
  taxRate: string;
  validUntil: string;
  agent: string;
  notes: string;
};

/** Error/warning messages keyed by the input's DOM id (e.g. "title", "item-i2-unitPrice"). */
export type QuoteMessages = Record<string, string>;

export const QUOTE_NOTES_MAX = 600;

export const itemFieldId = (itemId: string, field: "description" | "quantity" | "unitPrice" | "cost") => `item-${itemId}-${field}`;

/** "1,250.50" / "$1250" → 1250.5 (NaN if not a number). Empty → NaN. */
export function parseAmount(s: string) {
  const cleaned = s.replace(/[,\s$]/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
}

export function newItem(id: string, type: QuoteItemType = "Flight", description = "", quantity = "1"): QuoteItemDraft {
  return { id, type, description, quantity, unitPrice: "", cost: "" };
}

export function emptyQuoteForm(today: string): QuoteFormValues {
  return {
    recipient: "",
    title: "",
    destination: "",
    departDate: "",
    returnDate: "",
    adults: "2",
    children: "0",
    items: [newItem("i1")],
    discount: "",
    taxRate: String(DEFAULT_TAX_RATE),
    validUntil: addDays(today, DEFAULT_VALIDITY_DAYS),
    agent: "",
    notes: "",
  };
}

/** Lenient numbers for the live totals while typing (blank/invalid → 0). */
export function draftItemsForTotals(items: QuoteItemDraft[]) {
  const n = (s: string) => {
    const v = parseAmount(s);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  return items.map((i) => ({ quantity: n(i.quantity), unitPrice: n(i.unitPrice), cost: n(i.cost) }));
}

export function validateQuote(values: QuoteFormValues, today: string) {
  const errors: QuoteMessages = {};
  const warnings: QuoteMessages = {};

  if (!values.recipient) errors.recipient = "Choose who this quotation is for.";
  if (!values.title.trim()) errors.title = "Give the quotation a title, e.g. “Bali honeymoon”.";
  else if (values.title.trim().length > 80) errors.title = "Keep the title under 80 characters.";
  if (!values.destination.trim()) errors.destination = "Destination is required.";

  if (values.returnDate && !values.departDate) errors.departDate = "Add the departure date too.";
  if (values.departDate && values.returnDate && values.returnDate < values.departDate)
    errors.returnDate = "Return must be on or after departure.";

  const adults = Number(values.adults);
  const children = Number(values.children || "0");
  if (!Number.isInteger(adults) || adults < 1 || adults > 99) errors.adults = "At least 1 adult (whole number).";
  if (!Number.isInteger(children) || children < 0 || children > 99) errors.children = "Enter 0 or more.";

  if (values.items.length === 0) errors.items = "Add at least one item.";
  for (const item of values.items) {
    const qty = parseAmount(item.quantity);
    const price = parseAmount(item.unitPrice);
    const cost = parseAmount(item.cost);
    if (!item.description.trim()) errors[itemFieldId(item.id, "description")] = "Describe this item.";
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) errors[itemFieldId(item.id, "quantity")] = "1–999";
    if (!item.unitPrice.trim()) errors[itemFieldId(item.id, "unitPrice")] = "Enter a price.";
    else if (!Number.isFinite(price) || price < 0) errors[itemFieldId(item.id, "unitPrice")] = "Not a valid amount.";
    if (item.cost.trim() && (!Number.isFinite(cost) || cost < 0)) errors[itemFieldId(item.id, "cost")] = "Not a valid amount.";
    else if (Number.isFinite(cost) && Number.isFinite(price) && Number.isInteger(qty) && cost > lineTotal({ quantity: qty, unitPrice: price }))
      warnings[itemFieldId(item.id, "cost")] = "Cost is higher than the price — this line loses money.";
  }

  const subtotal = draftItemsForTotals(values.items).reduce((s, i) => s + lineTotal(i), 0);
  if (values.discount.trim()) {
    const d = parseAmount(values.discount);
    if (!Number.isFinite(d) || d < 0) errors.discount = "Enter an amount, e.g. 250.";
    else if (d > subtotal) errors.discount = "Discount can't be more than the subtotal.";
  }
  const tax = parseAmount(values.taxRate || "0");
  if (!Number.isFinite(tax) || tax < 0 || tax > 50) errors.taxRate = "Enter a percentage from 0 to 50.";

  if (!values.validUntil) errors.validUntil = "Set how long the prices are valid.";
  else if (values.validUntil < today) errors.validUntil = "Validity date must be today or later.";
  else if (values.departDate && values.validUntil > values.departDate)
    warnings.validUntil = "The quote stays valid until after departure — is that intended?";

  if (!values.agent) errors.agent = "Assign an agent.";
  if (values.notes.length > QUOTE_NOTES_MAX) errors.notes = `Notes must be ${QUOTE_NOTES_MAX} characters or fewer.`;

  return { errors, warnings };
}

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

/** Builds a Quotation from valid form values. */
export function toQuotation(
  values: QuoteFormValues,
  recipient: QuoteRecipient,
  base: Pick<Quotation, "id" | "created" | "status"> & Partial<Quotation>,
  today: string,
): Quotation {
  const items: QuoteItem[] = values.items.map((i) => ({
    id: i.id,
    type: i.type,
    description: tidy(i.description),
    quantity: parseAmount(i.quantity),
    unitPrice: parseAmount(i.unitPrice),
    cost: i.cost.trim() ? parseAmount(i.cost) : 0,
  }));
  return {
    ...base,
    recipient,
    title: tidy(values.title),
    destination: tidy(values.destination),
    departDate: values.departDate || undefined,
    returnDate: values.returnDate || undefined,
    adults: Number(values.adults),
    children: Number(values.children || "0"),
    items,
    discount: values.discount.trim() ? parseAmount(values.discount) : 0,
    taxRate: parseAmount(values.taxRate || "0"),
    validUntil: values.validUntil,
    agent: values.agent,
    notes: tidy(values.notes) ? values.notes.trim() : undefined,
    updated: today,
  };
}

export function quoteToForm(q: Quotation): QuoteFormValues {
  return {
    recipient: `${q.recipient.kind}:${q.recipient.id}`,
    title: q.title,
    destination: q.destination,
    departDate: q.departDate ?? "",
    returnDate: q.returnDate ?? "",
    adults: String(q.adults),
    children: String(q.children),
    items: q.items.map((i) => ({
      id: i.id,
      type: i.type,
      description: i.description,
      quantity: String(i.quantity),
      unitPrice: String(i.unitPrice),
      cost: i.cost ? String(i.cost) : "",
    })),
    discount: q.discount ? String(q.discount) : "",
    taxRate: String(q.taxRate),
    validUntil: q.validUntil,
    agent: q.agent,
    notes: q.notes ?? "",
  };
}

/** QT-3008 → QT-3009 */
export function nextQuoteId(existing: Pick<Quotation, "id">[]) {
  const max = existing.reduce((m, q) => Math.max(m, Number(q.id.replace(/\D/g, "")) || 0), 3000);
  return `QT-${max + 1}`;
}

/** Next free line-item id within a quotation ("i5" after i1…i4). */
export function nextItemId(items: { id: string }[]) {
  const max = items.reduce((m, i) => Math.max(m, Number(i.id.replace(/\D/g, "")) || 0), 0);
  return `i${max + 1}`;
}
