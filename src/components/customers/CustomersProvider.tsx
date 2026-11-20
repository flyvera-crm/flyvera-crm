"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Customer } from "@/types/crm";
import {
  clearStoredCustomers,
  getServerStoredCustomers,
  getStoredCustomers,
  saveCustomer,
  subscribeStoredCustomers,
  updateCustomer,
} from "@/lib/customer-store";
import {
  applyCustomerEdits,
  customerToFormValues,
  emptyCustomerForm,
  nextCustomerId,
  toCustomer,
  type CustomerFormValues,
} from "@/lib/customer-validation";
import { Drawer } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/icons";
import { todayIso, useHydrated } from "@/lib/dates";
import { CustomerForm, CUSTOMER_FORM_ID } from "./CustomerForm";

export { todayIso };

type AddedListener = (customer: Customer, all: Customer[]) => void;

export type AddCustomerOptions = {
  /** Pre-fill the form, e.g. when converting a lead. */
  initialValues?: Partial<CustomerFormValues>;
  /** Called after the new customer is saved. */
  onSaved?: (customer: Customer) => void;
  /** Extra line under the panel title. */
  context?: string;
};

type CustomersContextValue = {
  customers: Customer[];
  /** IDs of customers created in this browser (shown with a "New" tag). */
  addedIds: Set<string>;
  /** false during the server render / first paint, before browser-saved data is read. */
  hydrated: boolean;
  getCustomer: (id: string) => Customer | undefined;
  openAddForm: (options?: AddCustomerOptions) => void;
  openEditForm: (customer: Customer) => void;
  onCustomerAdded: (listener: AddedListener) => () => void;
  resetStoredCustomers: () => void;
  /** How many customers were added or edited in this browser. */
  changedCount: number;
};

const CustomersContext = createContext<CustomersContextValue | null>(null);

export function useCustomers() {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error("useCustomers must be used inside <CustomersProvider>");
  return ctx;
}

type FormState = ({ mode: "add" } & AddCustomerOptions) | { mode: "edit"; customer: Customer };

export function CustomersProvider({ initialCustomers, children }: { initialCustomers: Customer[]; children: ReactNode }) {
  const stored = useSyncExternalStore(subscribeStoredCustomers, getStoredCustomers, getServerStoredCustomers);
  const hydrated = useHydrated();
  const toast = useToast();

  const customers = useMemo(
    () => [...stored.added, ...initialCustomers.map((c) => stored.edited[c.id] ?? c)],
    [stored, initialCustomers],
  );
  const addedIds = useMemo(() => new Set(stored.added.map((c) => c.id)), [stored]);
  const changedCount = stored.added.length + Object.keys(stored.edited).length;

  const [form, setForm] = useState<FormState | null>(null); // stays set while the panel slides out
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0); // new key = fresh form each time it opens
  const dirtyRef = useRef(false);
  const [listeners] = useState(() => new Set<AddedListener>());

  const getCustomer = useCallback((id: string) => customers.find((c) => c.id === id), [customers]);

  const openForm = useCallback((next: FormState) => {
    dirtyRef.current = false;
    setFormKey((k) => k + 1);
    setForm(next);
    setOpen(true);
  }, []);
  const openAddForm = useCallback((options?: AddCustomerOptions) => openForm({ mode: "add", ...options }), [openForm]);
  const openEditForm = useCallback((customer: Customer) => openForm({ mode: "edit", customer }), [openForm]);

  const requestClose = useCallback(() => {
    if (dirtyRef.current && !window.confirm("Discard your changes? Anything you typed will be lost.")) return;
    setOpen(false);
  }, []);

  const handleSubmit = useCallback(
    (values: CustomerFormValues) => {
      dirtyRef.current = false;
      if (form?.mode === "edit") {
        const updated = applyCustomerEdits(form.customer, values);
        updateCustomer(updated); // ← later: replace with a call to your backend/API
        toast({
          message: (
            <p>
              Changes to <span className="font-semibold">{updated.name}</span> saved.
            </p>
          ),
        });
      } else {
        const customer = toCustomer(values, nextCustomerId(customers), todayIso());
        saveCustomer(customer); // ← later: replace with a call to your backend/API
        listeners.forEach((l) => l(customer, [customer, ...customers]));
        if (form?.onSaved) form.onSaved(customer); // the caller shows its own message
        else
          toast({
            message: (
              <p>
                <span className="font-semibold">{customer.name}</span> was added as{" "}
                <span className="font-mono text-gold-300">{customer.id}</span>.
              </p>
            ),
          });
      }
      setOpen(false);
    },
    [form, customers, listeners, toast],
  );

  const onCustomerAdded = useCallback(
    (listener: AddedListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [listeners],
  );

  const resetStoredCustomers = useCallback(() => {
    if (window.confirm(`Undo ${changedCount} change(s) — remove customers you added and restore edited demo customers?`))
      clearStoredCustomers();
  }, [changedCount]);

  const value = useMemo(
    () => ({ customers, addedIds, hydrated, getCustomer, openAddForm, openEditForm, onCustomerAdded, resetStoredCustomers, changedCount }),
    [customers, addedIds, hydrated, getCustomer, openAddForm, openEditForm, onCustomerAdded, resetStoredCustomers, changedCount],
  );

  const editing = form?.mode === "edit" ? form.customer : null;

  return (
    <CustomersContext.Provider value={value}>
      {children}

      <Drawer
        open={open}
        onClose={requestClose}
        title={editing ? "Edit customer" : "Add customer"}
        description={
          editing
            ? `Update ${editing.name}'s profile.`
            : (form?.mode === "add" && form.context) || "Create a new traveller profile."
        }
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="hidden text-xs text-navy-400 sm:block">
              <span className="text-rose-500">*</span> Required fields
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={requestClose}
                className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                form={CUSTOMER_FORM_ID}
                className="flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
              >
                <Icon name="check" size={16} className="text-gold-300" strokeWidth={2.5} />
                {editing ? "Save changes" : "Save customer"}
              </button>
            </div>
          </div>
        }
      >
        {/* Only rendered after the first open, so nothing date-dependent is server-rendered. */}
        {form && (
          <CustomerForm
            key={formKey}
            mode={form.mode}
            customerId={editing ? editing.id : nextCustomerId(customers)}
            initialValues={
              editing
                ? customerToFormValues(editing)
                : form.mode === "add" && form.initialValues
                  ? { ...emptyCustomerForm, ...form.initialValues }
                  : undefined
            }
            existing={editing ? customers.filter((c) => c.id !== editing.id) : customers}
            today={todayIso()}
            onSubmit={handleSubmit}
            onDirty={() => {
              dirtyRef.current = true;
            }}
          />
        )}
      </Drawer>
    </CustomersContext.Provider>
  );
}
