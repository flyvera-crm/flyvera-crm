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

// Validity, default tax, low-margin alert and terms are agency settings now: src/lib/settings-rules.ts (migration 20).
