// Supplier directory: shape and validation (pure; shared by the Suppliers page, its Server Actions and tests).
// The database checks the same limits (table checks) and who may write (Row Level Security).

export type SupplierType = "Airline" | "Hotel" | "Ground handler" | "Activity provider" | "Insurer" | "Visa agency" | "Other";
export const SUPPLIER_TYPES: SupplierType[] = ["Airline", "Hotel", "Ground handler", "Activity provider", "Insurer", "Visa agency", "Other"];

export type Supplier = {
  dbId: string;
  name: string;
  type: SupplierType;
  iataCode?: string;
  email?: string;
  phone?: string;
  paymentTermsDays: number;
  notes?: string;
  active: boolean;
};

export type SupplierForm = { name: string; type: SupplierType | ""; iataCode: string; email: string; phone: string; paymentTermsDays: string; notes: string };

export const emptySupplierForm = (): SupplierForm => ({ name: "", type: "", iataCode: "", email: "", phone: "", paymentTermsDays: "14", notes: "" });

export const supplierToForm = (s: Supplier): SupplierForm => ({
  name: s.name,
  type: s.type,
  iataCode: s.iataCode ?? "",
  email: s.email ?? "",
  phone: s.phone ?? "",
  paymentTermsDays: String(s.paymentTermsDays),
  notes: s.notes ?? "",
});

export function validateSupplier(f: SupplierForm) {
  const e: Partial<Record<keyof SupplierForm, string>> = {};
  const name = f.name.trim();
  if (name.length < 2 || name.length > 120) e.name = "Enter the supplier's name (2–120 characters).";
  if (!f.type || !SUPPLIER_TYPES.includes(f.type)) e.type = "Choose a type.";
  const iata = f.iataCode.trim().toUpperCase();
  if (iata && f.type !== "Airline") e.iataCode = "IATA codes are for airlines.";
  else if (iata && !/^[A-Z0-9]{2}$/.test(iata)) e.iataCode = "Two letters or digits, e.g. QR.";
  if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (f.phone.trim() && !/^\+?[0-9 ().-]{6,30}$/.test(f.phone.trim())) e.phone = "Enter a valid phone number.";
  const terms = Number(f.paymentTermsDays.trim());
  if (!f.paymentTermsDays.trim() || !Number.isInteger(terms) || terms < 0 || terms > 365) e.paymentTermsDays = "Whole days from 0 to 365.";
  if (f.notes.trim().length > 500) e.notes = "Keep notes under 500 characters.";
  return e;
}

/** The form as table columns (call only when validateSupplier found nothing). */
export function supplierRow(f: SupplierForm) {
  const blank = (v: string) => v.trim() || null;
  return {
    name: f.name.trim(),
    supplier_type: f.type as SupplierType,
    iata_code: f.type === "Airline" ? blank(f.iataCode.toUpperCase()) : null,
    email: blank(f.email.toLowerCase()),
    phone: blank(f.phone),
    payment_terms_days: Number(f.paymentTermsDays.trim()),
    notes: blank(f.notes),
  };
}
