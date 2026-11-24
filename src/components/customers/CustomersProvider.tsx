"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { Customer } from "@/types/crm";
import { saveCustomer } from "@/lib/actions/customers";
import type { CustomerAccess } from "@/lib/data/customers";
import { customerToFormValues, emptyCustomerForm, type CustomerFormValues } from "@/lib/customer-validation";
import { Drawer } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/icons";
import { todayIso, useHydrated } from "@/lib/dates";
import { CustomerForm, CUSTOMER_FORM_ID, type SubmitOutcome } from "./CustomerForm";

export { todayIso };

type AddedListener = (customer: Customer, all: Customer[]) => void;

export type AddCustomerOptions = {
  /** Pre-fill the form, e.g. when converting a lead. `agent` may be a user id or a display name. */
  initialValues?: Partial<CustomerFormValues>;
  /** Called after the new customer is saved. */
  onSaved?: (customer: Customer) => void;
  /** Extra line under the panel title. */
  context?: string;
};

type CustomersContextValue = {
  customers: Customer[];
  /** Codes of customers created in this session (shown with a "New" tag). */
  addedIds: Set<string>;
  /** false during the server render / first paint (for date-dependent labels). */
  hydrated: boolean;
  getCustomer: (id: string) => Customer | undefined;
  openAddForm: (options?: AddCustomerOptions) => void;
  openEditForm: (customer: Customer) => void;
  onCustomerAdded: (listener: AddedListener) => () => void;
  /** What the signed-in user may do (from the database roles). */
  access: CustomerAccess;
};

const CustomersContext = createContext<CustomersContextValue | null>(null);

export function useCustomers() {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error("useCustomers must be used inside <CustomersProvider>");
  return ctx;
}

type FormState = ({ mode: "add" } & AddCustomerOptions) | { mode: "edit"; customer: Customer };

/**
 * Customers come from Supabase (loaded by the CRM layout on the server, filtered by
 * Row Level Security). Saving calls a Server Action, which also refreshes that list.
 */
export function CustomersProvider({
  initialCustomers,
  access,
  children,
}: {
  initialCustomers: Customer[];
  access: CustomerAccess;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const toast = useToast();
  const [saving, startSaving] = useTransition();

  // Just-saved customers, shown until the refreshed list from the server arrives.
  const [recent, setRecent] = useState<{ base: Customer[]; items: Customer[] }>({ base: initialCustomers, items: [] });
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());

  const customers = useMemo(() => {
    if (recent.base !== initialCustomers || recent.items.length === 0) return initialCustomers;
    const byCode = new Map(recent.items.map((c) => [c.id, c]));
    const updated = initialCustomers.map((c) => byCode.get(c.id) ?? c);
    const fresh = recent.items.filter((c) => !initialCustomers.some((x) => x.id === c.id));
    return [...fresh, ...updated];
  }, [initialCustomers, recent]);

  const [form, setForm] = useState<FormState | null>(null); // stays set while the panel slides out
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0); // new key = fresh form each time it opens
  const dirtyRef = useRef(false);
  const [listeners] = useState(() => new Set<AddedListener>());

  const getCustomer = useCallback((id: string) => customers.find((c) => c.id === id), [customers]);

  /** Lead/quotation prefills carry an agent's display name; the form needs their user id. */
  const resolveAgent = useCallback(
    (value?: string) => {
      if (value && access.agentOptions.some((a) => a.id === value)) return value;
      const byName = value ? access.agentOptions.find((a) => a.name === value) : undefined;
      return byName?.id ?? access.defaultAgentId;
    },
    [access],
  );

  const openForm = useCallback((next: FormState) => {
    dirtyRef.current = false;
    setFormKey((k) => k + 1);
    setForm(next);
    setOpen(true);
  }, []);

  const openAddForm = useCallback(
    (options?: AddCustomerOptions) => {
      if (!access.canCreate) {
        toast({ tone: "info", message: "Your role can view customers but not add them. Ask a sales colleague or an admin." });
        return;
      }
      openForm({ mode: "add", ...options });
    },
    [access.canCreate, openForm, toast],
  );

  const openEditForm = useCallback(
    (customer: Customer) => {
      if (!access.canEdit) return;
      openForm({ mode: "edit", customer });
    },
    [access.canEdit, openForm],
  );

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirtyRef.current && !window.confirm("Discard your changes? Anything you typed will be lost.")) return;
    setOpen(false);
  }, [saving]);

  const handleSubmit = useCallback(
    (values: CustomerFormValues) =>
      new Promise<SubmitOutcome>((resolve) => {
        startSaving(async () => {
          const editing = form?.mode === "edit" ? form.customer : null;
          const result = await saveCustomer({ dbId: editing?.dbId }, values);
          if (!result.ok) {
            resolve({ message: result.message, fieldErrors: result.fieldErrors });
            return;
          }

          const saved = result.customer;
          dirtyRef.current = false;
          setRecent({ base: initialCustomers, items: [saved] });
          if (!editing) setAddedIds((ids) => new Set(ids).add(saved.id));
          setOpen(false);
          resolve(undefined);

          if (editing) {
            toast({
              message: (
                <p>
                  Changes to <span className="font-semibold">{saved.name}</span> saved.
                  {result.warning && <span className="mt-1 block text-amber-200">{result.warning}</span>}
                </p>
              ),
            });
            return;
          }
          listeners.forEach((l) => l(saved, [saved, ...customers]));
          if (form?.mode === "add" && form.onSaved) {
            form.onSaved(saved); // the caller shows its own message
            if (result.warning) toast({ tone: "info", message: result.warning });
          } else {
            toast({
              message: (
                <p>
                  <span className="font-semibold">{saved.name}</span> was added as{" "}
                  <span className="font-mono text-gold-300">{saved.id}</span>.
                  {result.warning && <span className="mt-1 block text-amber-200">{result.warning}</span>}
                </p>
              ),
            });
          }
        });
      }),
    [form, initialCustomers, customers, listeners, toast],
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

  const value = useMemo(
    () => ({ customers, addedIds, hydrated, getCustomer, openAddForm, openEditForm, onCustomerAdded, access }),
    [customers, addedIds, hydrated, getCustomer, openAddForm, openEditForm, onCustomerAdded, access],
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
                disabled={saving}
                className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                form={CUSTOMER_FORM_ID}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-800 disabled:cursor-wait disabled:opacity-70"
              >
                <Icon name="check" size={16} className="text-gold-300" strokeWidth={2.5} />
                {saving ? "Saving…" : editing ? "Save changes" : "Save customer"}
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
            customerId={editing ? editing.id : null}
            initialValues={
              editing
                ? customerToFormValues(editing)
                : {
                    ...emptyCustomerForm,
                    ...(form.mode === "add" ? form.initialValues : undefined),
                    agent: resolveAgent(form.mode === "add" ? form.initialValues?.agent : undefined),
                  }
            }
            storedPassport={editing?.passport}
            showPassport={access.canSeePassports}
            agentOptions={
              editing?.agentId && !access.agentOptions.some((a) => a.id === editing.agentId)
                ? [...access.agentOptions, { id: editing.agentId, name: editing.agent }]
                : access.agentOptions
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
