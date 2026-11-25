"use client";

// Dialogs for the booking's Ticketing section. Each validates with the same rules the
// Server Action re-checks (src/lib/ticketing-rules.ts) and stays open until the save works.
import { useState, type FormEvent, type ReactNode } from "react";
import type { Passenger, Pnr, Segment, Ticket } from "@/types/ticketing";
import type { Customer } from "@/types/crm";
import {
  CABIN_CLASSES,
  DOCUMENT_TYPES,
  emptyPassenger,
  emptyPnr,
  emptySegment,
  PASSENGER_TITLES,
  PASSENGER_TYPES,
  PNR_PROVIDERS,
  PNR_STATUSES,
  SEGMENT_STATUSES,
  TICKET_CHANGES,
  validatePassenger,
  validatePassport,
  validatePnr,
  validateSegment,
  validateTicket,
  validateTicketChange,
  type PassengerFormValues,
  type PassportFormValues,
  type PnrFormValues,
  type SegmentFormValues,
  type TicketFormValues,
} from "@/lib/ticketing-rules";
import { Modal } from "@/components/ui/Modal";
import { Field, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";

/* ─────────────── shared bits ─────────────── */

type SaveFn<T> = (v: T) => Promise<boolean>;

function useSave<T>(onSave: SaveFn<T>, onClose: () => void) {
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent, v: T, hasErrors: boolean) {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors || saving) return;
    setSaving(true);
    const ok = await onSave(v);
    setSaving(false);
    if (ok) onClose();
  }
  return { submitted, saving, submit };
}

function Footer({ formId, saving, label, onClose, danger }: { formId: string; saving: boolean; label: string; onClose: () => void; danger?: boolean }) {
  return (
    <>
      <button type="button" onClick={onClose} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
        Cancel
      </button>
      <button
        type="submit"
        form={formId}
        disabled={saving}
        className={cn(
          "rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70",
          danger ? "bg-rose-600 hover:bg-rose-700" : "bg-navy-900 hover:bg-navy-800",
        )}
      >
        {saving ? "Saving…" : label}
      </button>
    </>
  );
}

function Select({ id, value, onChange, children, invalid }: { id: string; value: string; onChange: (v: string) => void; children: ReactNode; invalid?: boolean }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass(invalid, "h-11 appearance-none pr-9")}>
        {children}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
    </div>
  );
}

const upper = "uppercase placeholder:normal-case";

/* ─────────────── passenger ─────────────── */

export function PassengerModal({
  passenger,
  customers,
  suggested,
  today,
  onClose,
  onSave,
}: {
  passenger?: Passenger;
  /** Customers this user can see (to link the traveller to a CRM customer). */
  customers: Customer[];
  /** Pre-fill for "add the booking's customer". */
  suggested?: Partial<PassengerFormValues>;
  today: string;
  onClose: () => void;
  onSave: SaveFn<PassengerFormValues>;
}) {
  const [v, setV] = useState<PassengerFormValues>(
    passenger
      ? {
          type: passenger.type,
          title: passenger.title ?? "",
          firstName: passenger.firstName,
          lastName: passenger.lastName,
          dateOfBirth: passenger.dateOfBirth ?? "",
          gender: passenger.gender ?? "",
          nationality: passenger.nationality ?? "",
          frequentFlyer: passenger.frequentFlyer ?? "",
          meal: passenger.meal ?? "",
          assistance: passenger.assistance ?? "",
          isLead: passenger.isLead,
          customerCode: passenger.customerCode ?? "",
        }
      : { ...emptyPassenger, ...suggested },
  );
  const errors = validatePassenger(v, today);
  const { submitted, saving, submit } = useSave(onSave, onClose);
  const err = (k: keyof PassengerFormValues) => (submitted ? errors[k] : undefined);
  const set = (patch: Partial<PassengerFormValues>) => setV((x) => ({ ...x, ...patch }));

  return (
    <Modal
      open
      onClose={onClose}
      title={passenger ? "Edit passenger" : "Add passenger"}
      description="Names exactly as in the passport — airlines reject tickets with spelling differences."
      footer={<Footer formId="passenger-form" saving={saving} label={passenger ? "Save passenger" : "Add passenger"} onClose={onClose} />}
    >
      <form id="passenger-form" onSubmit={(e) => submit(e, v, Object.keys(errors).length > 0)} noValidate className="grid grid-cols-2 gap-4">
        <Field id="paxType" label="Type" required className="col-span-1">
          <Select id="paxType" value={v.type} onChange={(x) => set({ type: x as PassengerFormValues["type"] })}>
            {PASSENGER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field id="paxTitle" label="Title" error={err("title")} className="col-span-1">
          <Select id="paxTitle" value={v.title} onChange={(x) => set({ title: x })}>
            <option value="">—</option>
            {PASSENGER_TITLES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field id="paxFirst" label="First name(s)" required error={err("firstName")} className="col-span-2 sm:col-span-1">
          <input id="paxFirst" value={v.firstName} onChange={(e) => set({ firstName: e.target.value })} className={inputClass(!!err("firstName"))} />
        </Field>
        <Field id="paxLast" label="Last name" required error={err("lastName")} className="col-span-2 sm:col-span-1">
          <input id="paxLast" value={v.lastName} onChange={(e) => set({ lastName: e.target.value })} className={inputClass(!!err("lastName"))} />
        </Field>
        <Field id="paxDob" label="Date of birth" required={v.type !== "Adult"} error={err("dateOfBirth")} className="col-span-1">
          <input id="paxDob" type="date" max={today} value={v.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} className={inputClass(!!err("dateOfBirth"))} />
        </Field>
        <Field id="paxGender" label="Gender" className="col-span-1">
          <Select id="paxGender" value={v.gender} onChange={(x) => set({ gender: x as PassengerFormValues["gender"] })}>
            <option value="">—</option>
            <option value="F">F</option>
            <option value="M">M</option>
            <option value="X">X</option>
          </Select>
        </Field>
        <Field id="paxNat" label="Nationality" className="col-span-2 sm:col-span-1">
          <input id="paxNat" value={v.nationality} onChange={(e) => set({ nationality: e.target.value })} className={inputClass(false)} />
        </Field>
        <Field id="paxCustomer" label="CRM customer" hint="Link to copy their saved passport." className="col-span-2 sm:col-span-1">
          <Select id="paxCustomer" value={v.customerCode} onChange={(x) => set({ customerCode: x })}>
            <option value="">Not a customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </Select>
        </Field>
        <Field id="paxFf" label="Frequent flyer no." error={err("frequentFlyer")} className="col-span-2 sm:col-span-1">
          <input id="paxFf" value={v.frequentFlyer} onChange={(e) => set({ frequentFlyer: e.target.value })} className={inputClass(!!err("frequentFlyer"))} />
        </Field>
        <Field id="paxMeal" label="Meal" error={err("meal")} className="col-span-2 sm:col-span-1">
          <input id="paxMeal" value={v.meal} onChange={(e) => set({ meal: e.target.value })} placeholder="e.g. Vegetarian" className={inputClass(!!err("meal"))} />
        </Field>
        <Field id="paxAssist" label="Special assistance" error={err("assistance")} className="col-span-2">
          <input id="paxAssist" value={v.assistance} onChange={(e) => set({ assistance: e.target.value })} placeholder="e.g. Wheelchair to the gate" className={inputClass(!!err("assistance"))} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm text-navy-700">
          <input type="checkbox" checked={v.isLead} onChange={(e) => set({ isLead: e.target.checked })} className="size-4 accent-navy-900" />
          Lead passenger (main contact for this booking)
        </label>
      </form>
    </Modal>
  );
}

/* ─────────────── travel document ─────────────── */

export function PassportModal({
  passenger,
  today,
  onClose,
  onSave,
  onCopy,
}: {
  passenger: Passenger;
  today: string;
  onClose: () => void;
  onSave: SaveFn<PassportFormValues>;
  /** Copies the linked customer's saved passport (number never shown). Absent when not linked. */
  onCopy?: () => Promise<boolean>;
}) {
  const [v, setV] = useState<PassportFormValues>({
    documentType: passenger.documentType ?? "Passport",
    number: "",
    expiry: passenger.documentExpiry ?? "",
    issuingCountry: passenger.documentIssuingCountry ?? passenger.nationality ?? "",
  });
  const errors = validatePassport(v, today);
  const { submitted, saving, submit } = useSave(onSave, onClose);
  const [copying, setCopying] = useState(false);
  const err = (k: keyof PassportFormValues) => (submitted ? errors[k] : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title="Travel document"
      description={
        <>
          For {passenger.firstName} {passenger.lastName}. Stored encrypted — afterwards only the last 4 characters are shown.
        </>
      }
      footer={<Footer formId="passport-form" saving={saving} label="Save document" onClose={onClose} />}
    >
      {onCopy && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl bg-sky-brand-light/50 p-3.5 text-sm text-navy-700 sm:flex-row sm:items-center sm:justify-between">
          <span>Use the passport saved on {passenger.customerCode}&apos;s customer profile?</span>
          <button
            type="button"
            disabled={copying}
            onClick={async () => {
              setCopying(true);
              const ok = await onCopy();
              setCopying(false);
              if (ok) onClose();
            }}
            className="shrink-0 rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
          >
            {copying ? "Copying…" : "Copy saved passport"}
          </button>
        </div>
      )}
      <form id="passport-form" onSubmit={(e) => submit(e, v, Object.keys(errors).length > 0)} noValidate className="grid grid-cols-2 gap-4">
        <Field id="docType" label="Document" required className="col-span-2 sm:col-span-1">
          <Select id="docType" value={v.documentType} onChange={(x) => setV({ ...v, documentType: x as PassportFormValues["documentType"] })}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field id="docNumber" label={passenger.documentLast4 ? `New number (now ••••${passenger.documentLast4})` : "Number"} required error={err("number")} className="col-span-2 sm:col-span-1">
          <input id="docNumber" value={v.number} autoComplete="off" spellCheck={false} onChange={(e) => setV({ ...v, number: e.target.value })} className={inputClass(!!err("number"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="docExpiry" label="Expiry" required error={err("expiry")} className="col-span-2 sm:col-span-1">
          <input id="docExpiry" type="date" value={v.expiry} onChange={(e) => setV({ ...v, expiry: e.target.value })} className={inputClass(!!err("expiry"))} />
        </Field>
        <Field id="docCountry" label="Issuing country" required error={err("issuingCountry")} className="col-span-2 sm:col-span-1">
          <input id="docCountry" value={v.issuingCountry} onChange={(e) => setV({ ...v, issuingCountry: e.target.value })} className={inputClass(!!err("issuingCountry"))} />
        </Field>
      </form>
    </Modal>
  );
}

/* ─────────────── reservation (PNR) ─────────────── */

export function PnrModal({ pnr, onClose, onSave }: { pnr?: Pnr; onClose: () => void; onSave: SaveFn<PnrFormValues> }) {
  const [v, setV] = useState<PnrFormValues>(
    pnr
      ? {
          recordLocator: pnr.recordLocator,
          airlineLocator: pnr.airlineLocator ?? "",
          provider: pnr.provider,
          status: pnr.status,
          ticketingDeadline: pnr.ticketingDeadline ?? "",
        }
      : emptyPnr,
  );
  const errors = validatePnr(v);
  const { submitted, saving, submit } = useSave(onSave, onClose);
  const err = (k: keyof PnrFormValues) => (submitted ? errors[k] : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title={pnr ? `Reservation ${pnr.recordLocator}` : "Add reservation (PNR)"}
      description="The booking reference from the GDS or the airline."
      footer={<Footer formId="pnr-form" saving={saving} label="Save reservation" onClose={onClose} />}
    >
      <form id="pnr-form" onSubmit={(e) => submit(e, v, Object.keys(errors).length > 0)} noValidate className="grid grid-cols-2 gap-4">
        <Field id="pnrLocator" label="Record locator" required error={err("recordLocator")} className="col-span-2 sm:col-span-1">
          <input id="pnrLocator" value={v.recordLocator} onChange={(e) => setV({ ...v, recordLocator: e.target.value })} placeholder="e.g. K7Q2MX" className={inputClass(!!err("recordLocator"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="pnrAirline" label="Airline locator" error={err("airlineLocator")} className="col-span-2 sm:col-span-1">
          <input id="pnrAirline" value={v.airlineLocator} onChange={(e) => setV({ ...v, airlineLocator: e.target.value })} className={inputClass(!!err("airlineLocator"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="pnrProvider" label="Booked via" required className="col-span-1">
          <Select id="pnrProvider" value={v.provider} onChange={(x) => setV({ ...v, provider: x as PnrFormValues["provider"] })}>
            {PNR_PROVIDERS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Field id="pnrStatus" label="Status" required className="col-span-1">
          <Select id="pnrStatus" value={v.status} onChange={(x) => setV({ ...v, status: x as PnrFormValues["status"] })}>
            {PNR_STATUSES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Field id="pnrDeadline" label="Ticketing deadline" error={err("ticketingDeadline")} hint="As shown by the GDS — the booking is cancelled if not ticketed by then." className="col-span-2">
          <input id="pnrDeadline" type="datetime-local" value={v.ticketingDeadline} onChange={(e) => setV({ ...v, ticketingDeadline: e.target.value })} className={inputClass(!!err("ticketingDeadline"))} />
        </Field>
      </form>
    </Modal>
  );
}

/* ─────────────── flight leg ─────────────── */

export function SegmentModal({ segment, pnrs, onClose, onSave }: { segment?: Segment; pnrs: Pnr[]; onClose: () => void; onSave: SaveFn<SegmentFormValues> }) {
  const [v, setV] = useState<SegmentFormValues>(
    segment
      ? {
          pnrId: segment.pnrId ?? "",
          carrier: segment.carrier,
          flightNumber: segment.flightNumber,
          operatingCarrier: segment.operatingCarrier ?? "",
          origin: segment.origin,
          destination: segment.destination,
          departsAt: segment.departsAt,
          arrivesAt: segment.arrivesAt,
          cabin: segment.cabin,
          bookingClass: segment.bookingClass ?? "",
          status: segment.status,
        }
      : { ...emptySegment, pnrId: pnrs.length === 1 ? pnrs[0].id : "" },
  );
  const errors = validateSegment(v);
  const { submitted, saving, submit } = useSave(onSave, onClose);
  const err = (k: keyof SegmentFormValues) => (submitted ? errors[k] : undefined);
  const set = (patch: Partial<SegmentFormValues>) => setV((x) => ({ ...x, ...patch }));

  return (
    <Modal
      open
      onClose={onClose}
      title={segment ? `Flight ${segment.carrier}${segment.flightNumber}` : "Add flight"}
      description="Times are airport local time, exactly as printed on the itinerary."
      footer={<Footer formId="segment-form" saving={saving} label="Save flight" onClose={onClose} />}
    >
      <form id="segment-form" onSubmit={(e) => submit(e, v, Object.keys(errors).length > 0)} noValidate className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field id="segCarrier" label="Airline" required error={err("carrier")} className="col-span-1">
          <input id="segCarrier" value={v.carrier} onChange={(e) => set({ carrier: e.target.value })} placeholder="EK" maxLength={2} className={inputClass(!!err("carrier"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="segNumber" label="Flight no." required error={err("flightNumber")} className="col-span-1">
          <input id="segNumber" value={v.flightNumber} onChange={(e) => set({ flightNumber: e.target.value })} placeholder="7" className={inputClass(!!err("flightNumber"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="segFrom" label="From" required error={err("origin")} className="col-span-1">
          <input id="segFrom" value={v.origin} onChange={(e) => set({ origin: e.target.value })} placeholder="DXB" maxLength={3} className={inputClass(!!err("origin"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="segTo" label="To" required error={err("destination")} className="col-span-1">
          <input id="segTo" value={v.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="LHR" maxLength={3} className={inputClass(!!err("destination"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="segDep" label="Departs" required error={err("departsAt")} className="col-span-2">
          <input id="segDep" type="datetime-local" value={v.departsAt} onChange={(e) => set({ departsAt: e.target.value })} className={inputClass(!!err("departsAt"))} />
        </Field>
        <Field id="segArr" label="Arrives" required error={err("arrivesAt")} className="col-span-2">
          <input id="segArr" type="datetime-local" value={v.arrivesAt} onChange={(e) => set({ arrivesAt: e.target.value })} className={inputClass(!!err("arrivesAt"))} />
        </Field>
        <Field id="segCabin" label="Cabin" required className="col-span-2">
          <Select id="segCabin" value={v.cabin} onChange={(x) => set({ cabin: x as SegmentFormValues["cabin"] })}>
            {CABIN_CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field id="segClass" label="Booking class" error={err("bookingClass")} className="col-span-1">
          <input id="segClass" value={v.bookingClass} onChange={(e) => set({ bookingClass: e.target.value })} placeholder="Y" maxLength={1} className={inputClass(!!err("bookingClass"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="segOp" label="Operated by" error={err("operatingCarrier")} className="col-span-1">
          <input id="segOp" value={v.operatingCarrier} onChange={(e) => set({ operatingCarrier: e.target.value })} maxLength={2} className={inputClass(!!err("operatingCarrier"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="segPnr" label="Reservation" className="col-span-2">
          <Select id="segPnr" value={v.pnrId} onChange={(x) => set({ pnrId: x })}>
            <option value="">Not linked</option>
            {pnrs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.recordLocator} ({p.provider})
              </option>
            ))}
          </Select>
        </Field>
        <Field id="segStatus" label="Status" className="col-span-2">
          <Select id="segStatus" value={v.status} onChange={(x) => set({ status: x as SegmentFormValues["status"] })}>
            {SEGMENT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

/* ─────────────── record an issued ticket ─────────────── */

export function IssueTicketModal({
  passengers,
  pnrs,
  preselectPassengerId,
  today,
  bookingCreated,
  onClose,
  onSave,
}: {
  passengers: Passenger[];
  pnrs: Pnr[];
  preselectPassengerId?: string;
  today: string;
  bookingCreated: string;
  onClose: () => void;
  onSave: SaveFn<TicketFormValues>;
}) {
  const active = pnrs.filter((p) => p.status === "Active" || p.status === "Ticketed");
  const [v, setV] = useState<TicketFormValues>({
    passengerId: preselectPassengerId ?? (passengers.length === 1 ? passengers[0].id : ""),
    pnrId: active.length === 1 ? active[0].id : "",
    ticketNumber: "",
    airline: "",
    baseFare: "",
    taxes: "",
    issuedOn: today,
    confirmed: false,
  });
  const errors = validateTicket(v, today, bookingCreated);
  const { submitted, saving, submit } = useSave(onSave, onClose);
  const err = (k: keyof TicketFormValues) => (submitted ? errors[k] : undefined);
  const set = (patch: Partial<TicketFormValues>) => setV((x) => ({ ...x, ...patch }));

  return (
    <Modal
      open
      onClose={onClose}
      title="Record issued ticket"
      description="Enter the ticket exactly as the airline or GDS issued it. Recording it here doesn't issue anything."
      footer={<Footer formId="ticket-form" saving={saving} label="Record ticket" onClose={onClose} />}
    >
      <form id="ticket-form" onSubmit={(e) => submit(e, v, Object.keys(errors).length > 0)} noValidate className="grid grid-cols-2 gap-4">
        <Field id="tktPax" label="Passenger" required error={err("passengerId")} className="col-span-2 sm:col-span-1">
          <Select id="tktPax" value={v.passengerId} onChange={(x) => set({ passengerId: x })} invalid={!!err("passengerId")}>
            <option value="">Choose…</option>
            {passengers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="tktPnr" label="Issued on reservation" required error={err("pnrId")} className="col-span-2 sm:col-span-1">
          <Select id="tktPnr" value={v.pnrId} onChange={(x) => set({ pnrId: x })} invalid={!!err("pnrId")}>
            <option value="">Choose…</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.recordLocator} ({p.provider})
              </option>
            ))}
          </Select>
        </Field>
        <Field id="tktNumber" label="Ticket number (13 digits)" required error={err("ticketNumber")} className="col-span-2 sm:col-span-1">
          <input id="tktNumber" value={v.ticketNumber} inputMode="numeric" onChange={(e) => set({ ticketNumber: e.target.value })} placeholder="176 2104810001" className={inputClass(!!err("ticketNumber"), "h-11 font-mono")} />
        </Field>
        <Field id="tktAirline" label="Issuing airline" required error={err("airline")} className="col-span-1">
          <input id="tktAirline" value={v.airline} maxLength={2} onChange={(e) => set({ airline: e.target.value })} placeholder="EK" className={inputClass(!!err("airline"), cn("h-11 font-mono", upper))} />
        </Field>
        <Field id="tktIssued" label="Issue date" required error={err("issuedOn")} className="col-span-1">
          <input id="tktIssued" type="date" max={today} value={v.issuedOn} onChange={(e) => set({ issuedOn: e.target.value })} className={inputClass(!!err("issuedOn"))} />
        </Field>
        <Field id="tktFare" label="Fare (USD)" required error={err("baseFare")} className="col-span-1">
          <input id="tktFare" value={v.baseFare} inputMode="decimal" onChange={(e) => set({ baseFare: e.target.value })} className={inputClass(!!err("baseFare"))} />
        </Field>
        <Field id="tktTaxes" label="Taxes (USD)" error={err("taxes")} className="col-span-1">
          <input id="tktTaxes" value={v.taxes} inputMode="decimal" onChange={(e) => set({ taxes: e.target.value })} placeholder="0" className={inputClass(!!err("taxes"))} />
        </Field>
        <div className="col-span-2">
          <label
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3.5 text-sm",
              err("confirmed") ? "border-rose-300 bg-rose-50" : v.confirmed ? "border-emerald-300 bg-emerald-50/60" : "border-navy-100",
            )}
          >
            <input
              type="checkbox"
              checked={v.confirmed}
              onChange={(e) => set({ confirmed: e.target.checked })}
              aria-invalid={err("confirmed") ? true : undefined}
              className="mt-0.5 size-4 shrink-0 accent-navy-900"
            />
            <span className="text-navy-700">
              I confirm this ticket number was <span className="font-semibold">issued by the airline or GDS</span> and matches the ticket
              document.
            </span>
          </label>
          {err("confirmed") && <p className="mt-1.5 text-xs font-medium text-rose-600">{err("confirmed")}</p>}
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────── void / refund / exchange ─────────────── */

export function TicketChangeModal({ ticket, onClose, onSave }: { ticket: Ticket; onClose: () => void; onSave: SaveFn<{ status: string; reason: string }> }) {
  const [v, setV] = useState({ status: "Voided", reason: "" });
  const errors = validateTicketChange(v.status, v.reason);
  const { submitted, saving, submit } = useSave(onSave, onClose);
  const hint: Record<string, string> = {
    Voided: "Cancelled with the airline on the day of issue — no money involved.",
    Refunded: "Refunded through the airline. Record any money returned to the customer on the booking separately.",
    Exchanged: "Replaced by a new ticket (date or route change). Record the new ticket afterwards.",
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Change ticket ${ticket.ticketNumber}`}
      description={`${ticket.passengerName} · ${ticket.airline}. This can't be undone — the ticket keeps its history.`}
      footer={<Footer formId="ticket-change-form" saving={saving} label={`Mark ${v.status.toLowerCase()}`} onClose={onClose} danger />}
    >
      <form id="ticket-change-form" onSubmit={(e) => submit(e, v, Object.keys(errors).length > 0)} noValidate className="grid gap-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-navy-700">What happened?</legend>
          <div className="grid grid-cols-3 gap-2">
            {TICKET_CHANGES.map((s) => (
              <label
                key={s}
                className={cn(
                  "flex h-10 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium",
                  v.status === s ? "border-navy-900 bg-navy-900 text-white" : "border-navy-100 text-navy-600 hover:bg-navy-50",
                )}
              >
                <input type="radio" name="ticketChange" value={s} checked={v.status === s} onChange={() => setV({ ...v, status: s })} className="sr-only" />
                {s}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-navy-400">{hint[v.status]}</p>
        </fieldset>
        <Field id="ticketReason" label="Reason" required error={submitted ? errors.reason : undefined}>
          <textarea
            id="ticketReason"
            rows={2}
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.target.value })}
            placeholder="e.g. Passenger name misspelt — voided same day"
            className={inputClass(submitted && !!errors.reason, "min-h-16 resize-y py-2.5")}
          />
        </Field>
      </form>
    </Modal>
  );
}
