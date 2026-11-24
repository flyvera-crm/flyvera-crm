// Invoices (one active invoice per booking — migration 17).

/** What's stored. "Paid" only exists on old/imported rows; payment status is calculated (see invoiceStatus). */
export type InvoiceStoredStatus = "Draft" | "Issued" | "Paid" | "Void";
/** What the screens show: Draft / Void as stored, otherwise worked out from payments and the due date. */
export type InvoiceStatus = "Draft" | "Unpaid" | "Partially paid" | "Overdue" | "Paid" | "Void";
export type InvoiceLineType = "Flight" | "Hotel" | "Transfer" | "Activity" | "Insurance" | "Visa" | "Service fee" | "Other";

export type InvoiceLine = { id: string; type: InvoiceLineType; description: string; quantity: number; unitPrice: number; total: number };

/** A receipt or refund note on the invoice's booking (refunds reduce what's paid). */
export type InvoicePayment = {
  id: string; // "p1"… / "r1"… — same ids as the booking's receipts
  kind: "payment" | "refund";
  date: string;
  amount: number;
  method: string;
};

export type BillTo = { code?: string; name: string; email?: string | null; phone?: string; city?: string; country?: string };
export type InvoicePassenger = { name: string; type: string; tickets: string[] };

export type Invoice = {
  id: string; // database id (used in URLs: drafts have no number yet)
  number?: string; // INV-2026-0001, given when issued
  storedStatus: InvoiceStoredStatus;
  bookingDbId: string;
  bookingCode: string;
  bookingTitle: string;
  customerCode: string;
  /** Frozen at issue; for drafts, the customer's current details. */
  billTo: BillTo;
  /** Frozen at issue (with issued ticket numbers); empty for drafts. */
  passengers: InvoicePassenger[];
  issueOn?: string;
  dueOn?: string;
  currency: string;
  lines: InvoiceLine[];
  subtotal: number;
  discount: number;
  taxRate: number;
  tax: number;
  total: number;
  notes?: string;
  voidReason?: string;
  voidedOn?: string;
  created: string;
  /** Payments linked to this invoice, plus the booking's paid refunds (newest last). */
  payments: InvoicePayment[];
  /** Net received for this invoice (linked payments minus paid refunds). */
  paid: number;
};

export type InvoiceAccess = {
  /** Admin, finance, ticketing, sales (for bookings whose money they see). Not support. */
  canView: boolean;
  /** Create, refresh, issue and void: finance and admins only. */
  canManage: boolean;
};

export type InvoiceHistoryLine = { date: string; text: string };
