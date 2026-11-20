import type { IconName } from "@/components/icons";
import type { QuoteDisplayStatus, QuoteItemType } from "@/types/crm";
import type { BadgeTone } from "@/components/ui/Badge";

// Line item types: icon + the placeholder text shown when you add one.
export const QUOTE_ITEM_TYPES: { value: QuoteItemType; icon: IconName; placeholder: string }[] = [
  { value: "Flight", icon: "plane", placeholder: "e.g. Return flights LHR → MLE, economy" },
  { value: "Hotel", icon: "calendar", placeholder: "e.g. 7 nights, Beach Villa, half board" },
  { value: "Transfer", icon: "arrowRight", placeholder: "e.g. Seaplane transfer, return" },
  { value: "Activity", icon: "sparkles", placeholder: "e.g. Sunset dolphin cruise" },
  { value: "Insurance", icon: "check", placeholder: "e.g. Comprehensive travel insurance" },
  { value: "Visa", icon: "document", placeholder: "e.g. Tourist visa processing" },
  { value: "Other", icon: "plus", placeholder: "Describe the item" },
];

export const QUOTE_STATUS_TONE: Record<QuoteDisplayStatus, BadgeTone> = {
  Draft: "neutral",
  Sent: "info",
  Accepted: "success",
  Declined: "danger",
  Expired: "warning",
};

/** Days a new quotation stays valid by default. */
export const DEFAULT_VALIDITY_DAYS = 14;

/** Default tax/service charge % on new quotations (0 = none). */
export const DEFAULT_TAX_RATE = 0;

/** Margin below this % shows a warning in the builder. */
export const LOW_MARGIN_PERCENT = 8;

/** Printed at the bottom of every quotation. Edit to match your agency's terms. */
export const QUOTE_TERMS = [
  "Prices are per the items listed and subject to availability until booked.",
  "A 30% deposit confirms the booking; the balance is due 30 days before departure.",
  "Flight fares are only guaranteed once tickets are issued.",
  "Cancellation charges apply as per supplier policies.",
];
