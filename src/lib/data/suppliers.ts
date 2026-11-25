// Supplier directory. Row Level Security: admin, ticketing and finance manage; sales read; support sees none.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AppRole } from "@/lib/auth";
import type { Supplier, SupplierType } from "@/lib/supplier-rules";

export type SupplierAccess = { canView: boolean; canManage: boolean };

const VIEW: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent", "finance_manager"];
const MANAGE: AppRole[] = ["admin", "ticketing_agent", "finance_manager"];

export function supplierAccess(role: AppRole | undefined): SupplierAccess {
  return { canView: Boolean(role && VIEW.includes(role)), canManage: Boolean(role && MANAGE.includes(role)) };
}

type Row = {
  id: string;
  name: string;
  supplier_type: SupplierType;
  iata_code: string | null;
  email: string | null;
  phone: string | null;
  payment_terms_days: number;
  notes: string | null;
  active: boolean;
};

export const getSuppliers = cache(async (): Promise<{ suppliers: Supplier[]; access: SupplierAccess }> => {
  const user = await getCurrentUser();
  const access = supplierAccess(user.membership?.role);
  if (!access.canView) return { suppliers: [], access };
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id, name, supplier_type, iata_code, email, phone, payment_terms_days, notes, active")
    .order("name");
  const suppliers = ((data ?? []) as Row[]).map((r) => ({
    dbId: r.id,
    name: r.name,
    type: r.supplier_type,
    iataCode: r.iata_code ?? undefined,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    paymentTermsDays: r.payment_terms_days,
    notes: r.notes ?? undefined,
    active: r.active,
  }));
  return { suppliers, access };
});
