"use client";

import { Icon } from "@/components/icons";
import { useCustomers } from "./CustomersProvider";

export function AddCustomerButton() {
  const { openAddForm } = useCustomers();
  return (
    <button
      type="button"
      onClick={() => openAddForm()}
      className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
    >
      <Icon name="plus" size={16} className="text-gold-300" /> Add customer
    </button>
  );
}
