"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { saveSupplier, setSupplierActive, type SupplierResult } from "@/lib/actions/suppliers";
import {
  emptySupplierForm,
  SUPPLIER_TYPES,
  supplierToForm,
  validateSupplier,
  type Supplier,
  type SupplierForm,
  type SupplierType,
} from "@/lib/supplier-rules";
import { fold } from "@/lib/customer-search";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Field, fieldA11y, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/format";

/** Supplier directory: search, filter, add / edit, deactivate. `canManage` = admin, ticketing, finance. */
export function SuppliersWorkspace({ suppliers, canManage }: { suppliers: Supplier[]; canManage: boolean }) {
  const toast = useToast();
  const [busy, startBusy] = useTransition();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SupplierType | "">("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return suppliers.filter(
      (s) =>
        (showInactive || s.active) &&
        (!type || s.type === type) &&
        (!q || q.split(/\s+/).every((w) => fold([s.name, s.type, s.iataCode ?? "", s.email ?? "", s.phone ?? ""].join(" ")).includes(w))),
    );
  }, [suppliers, query, type, showInactive]);

  const run = (fn: () => Promise<SupplierResult>, after?: () => void) =>
    startBusy(async () => {
      const r = await fn();
      toast({ tone: r.ok ? undefined : "info", message: <p>{r.message}</p> });
      if (r.ok) after?.();
    });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-navy-50 p-4 sm:flex-row sm:items-center sm:p-5">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search suppliers</span>
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, IATA code, email…"
            className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
          />
        </label>
        <select value={type} onChange={(e) => setType(e.target.value as SupplierType | "")} aria-label="Type" className="h-10 rounded-xl border border-navy-100 bg-white px-3 text-sm text-navy-700">
          <option value="">All types</option>
          {SUPPLIER_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-1 text-sm text-navy-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 rounded border-navy-200" />
          Show inactive
        </label>
        {canManage && (
          <button onClick={() => setEditing("new")} className="flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
            <Icon name="plus" size={16} /> Add supplier
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <Icon name="globe" size={28} className="text-navy-300" />
          <p className="mt-3 font-semibold text-navy-900">{suppliers.length ? "No suppliers match" : "No suppliers yet"}</p>
          <p className="mt-1 text-sm text-navy-400">{suppliers.length ? "Try another search or filter." : canManage ? "Add the airlines, hotels and partners you book with." : "Ticketing or finance add suppliers."}</p>
        </div>
      ) : (
        <ul className="divide-y divide-navy-50">
          {visible.map((s) => (
            <li key={s.dbId} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6", !s.active && "bg-navy-50/40")}>
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium text-navy-900">
                  {s.name}
                  <Badge tone="neutral">{s.type}</Badge>
                  {s.iataCode && <span className="font-mono text-xs text-navy-500">{s.iataCode}</span>}
                  {!s.active && <Badge tone="warning">Inactive</Badge>}
                </p>
                <p className="mt-0.5 truncate text-xs text-navy-500">
                  {[s.email, s.phone, `payment terms ${s.paymentTermsDays} days`].filter(Boolean).join(" · ")}
                </p>
                {s.notes && <p className="mt-0.5 text-xs text-navy-400">{s.notes}</p>}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1.5">
                  <button disabled={busy} onClick={() => setEditing(s)} className="rounded-lg border border-navy-100 px-2.5 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-60">
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => setSupplierActive(s.dbId, !s.active))}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-60",
                      s.active ? "border border-rose-200 text-rose-700 hover:bg-rose-50" : "bg-emerald-600 text-white hover:bg-emerald-700",
                    )}
                  >
                    {s.active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <SupplierModal
          supplier={editing === "new" ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(form) => run(() => saveSupplier(editing === "new" ? null : editing.dbId, form), () => setEditing(null))}
        />
      )}
    </Card>
  );
}

function SupplierModal({ supplier, busy, onClose, onSave }: { supplier: Supplier | null; busy: boolean; onClose: () => void; onSave: (f: SupplierForm) => void }) {
  const [f, setF] = useState<SupplierForm>(() => (supplier ? supplierToForm(supplier) : emptySupplierForm()));
  const [submitted, setSubmitted] = useState(false);
  const errors = validateSupplier(f);
  const err = (k: keyof SupplierForm) => (submitted ? errors[k] : undefined);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    onSave(f);
  }

  const input = (k: keyof SupplierForm, label: string, opts: { required?: boolean; wide?: boolean; type?: string; hint?: string } = {}) => (
    <Field id={`sup-${k}`} label={label} required={opts.required} error={err(k)} hint={opts.hint} className={opts.wide ? "sm:col-span-2" : undefined}>
      <input
        {...fieldA11y(`sup-${k}`, { error: err(k), hint: opts.hint })}
        type={opts.type ?? "text"}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        className={inputClass(!!err(k))}
      />
    </Field>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={supplier ? `Edit ${supplier.name}` : "Add supplier"}
      description="Suppliers can be linked to booked services and their payments."
      footer={
        <>
          <button onClick={onClose} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
            Cancel
          </button>
          <button type="submit" form="supplier-form" disabled={busy} className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60">
            {supplier ? "Save" : "Add supplier"}
          </button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {input("name", "Name", { required: true, wide: true })}
        <Field id="sup-type" label="Type" required error={err("type")}>
          <select
            {...fieldA11y("sup-type", { error: err("type") })}
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value as SupplierType })}
            className={inputClass(!!err("type"), "h-11")}
          >
            <option value="">Choose…</option>
            {SUPPLIER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        {f.type === "Airline" ? input("iataCode", "IATA code", { hint: "Two characters, e.g. QR." }) : <div className="hidden sm:block" />}
        {input("email", "Email", { type: "email" })}
        {input("phone", "Phone", { type: "tel" })}
        {input("paymentTermsDays", "Payment terms (days)", { required: true, hint: "For information; supplier due dates follow the agency setting." })}
        <Field id="sup-notes" label="Notes" error={err("notes")} className="sm:col-span-2">
          <textarea
            {...fieldA11y("sup-notes", { error: err("notes") })}
            rows={3}
            maxLength={520}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
            className={inputClass(!!err("notes"), "py-2.5")}
          />
        </Field>
      </form>
    </Modal>
  );
}
