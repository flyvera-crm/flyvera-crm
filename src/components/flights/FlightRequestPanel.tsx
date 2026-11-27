"use client";

// "Describe the trip": the request reader (on our own server, no AI service) turns the agent's words into
// search details that the AGENT reviews, edits and approves before anything is saved. No fares, prices or
// availability are shown here (only the budget the agent typed). Customer details are linked, never typed.
import { useState, useTransition, type ReactNode } from "react";
import { discardFlightRequest, readFlightRequest, saveFlightRequest } from "@/lib/actions/flight-requests";
import { callAction } from "@/lib/action-call";
import {
  BAGGAGE,
  CABINS,
  DAILY_LIMIT,
  FARE_RULES,
  MAX_EXTRA_LEGS,
  MAX_REQUEST_CHARS,
  STOPS,
  TIME_SLOTS,
  TRIP_TYPES,
  validateDraft,
  type FlightRequestDraft,
  type Leg,
} from "@/lib/flight-request";
import { useCustomers } from "@/components/customers/CustomersProvider";
import { useLeadList } from "@/lib/lead-store";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";

type Reading = { actionId: string; draft: FlightRequestDraft; questions: string[] };

export function FlightRequestPanel({ initialRemaining, today }: { initialRemaining: number; today: string }) {
  const toast = useToast();
  const { customers } = useCustomers();
  const leads = useLeadList();
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [remaining, setRemaining] = useState(initialRemaining);
  const [reading, setReading] = useState<Reading | null>(null);
  const [draft, setDraft] = useState<FlightRequestDraft | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const errors = draft ? validateDraft(draft, today) : {};
  const err = (k: keyof FlightRequestDraft) => (submitted ? errors[k] : undefined);
  const set = (patch: Partial<FlightRequestDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const reset = () => {
    setReading(null);
    setDraft(null);
    setReviewed(false);
    setSubmitted(false);
  };

  function read() {
    setMessage(null);
    start(async () => {
      const r = await callAction(() => readFlightRequest(text, link), "Read flight request");
      if ("remaining" in r && typeof r.remaining === "number") setRemaining(r.remaining);
      if (!r.ok) return setMessage(r.message);
      setReading({ actionId: r.actionId, draft: r.draft, questions: r.questions });
      setDraft(r.draft);
      setReviewed(false);
      setSubmitted(false);
    });
  }

  function save() {
    if (!reading || !draft) return;
    setSubmitted(true);
    if (Object.keys(errors).length || !reviewed) return;
    start(async () => {
      const r = await callAction(() => saveFlightRequest(reading.actionId, draft, link, reviewed), "Save flight search");
      if (!r.ok) return setMessage(r.message);
      toast({ message: <p>{r.message}</p> });
      reset();
      setText("");
    });
  }

  function discard() {
    if (!reading) return;
    start(async () => {
      const r = await callAction(() => discardFlightRequest(reading.actionId), "Discard reading");
      toast({ tone: "info", message: <p>{r.message}</p> });
      reset();
    });
  }

  return (
    <Card>
      <CardHeader title="Describe the trip" subtitle="Your request is read into search details for you to review, here in the CRM. It never shows fares or availability." />
      <div className="space-y-4 p-5 sm:p-6">
        {!reading ? (
          <>
            <p role="note" className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              <span>
                Only trip details. <span className="font-semibold">Don&apos;t include names, phone numbers, e-mail addresses, passport or other ID numbers</span>: link the lead or customer below instead (it stays in the CRM).
              </span>
            </p>
            <Field id="tripText" label="Trip request" hint={`${text.length}/${MAX_REQUEST_CHARS} · ${remaining} of ${DAILY_LIMIT} readings left today`}>
              <textarea
                id="tripText"
                rows={3}
                maxLength={MAX_REQUEST_CHARS}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. 2 adults and 1 child, Dubai to London around 15 Jan, back 29 Jan, business, prefer Emirates, budget about USD 9,000"
                className={inputClass(false, "min-h-20 resize-y py-2.5")}
              />
            </Field>
            <LinkSelect value={link} onChange={setLink} leads={leads} customers={customers} />
            {message && <p className="text-sm text-rose-600">{message}</p>}
            <button
              onClick={read}
              disabled={busy || !text.trim() || remaining <= 0}
              className="inline-flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
            >
              <Icon name="sparkles" size={16} className="text-gold-300" /> {busy ? "Reading…" : "Read request"}
            </button>
          </>
        ) : (
          draft && (
            <>
              <p className="text-sm text-navy-500">Check and correct the reading, and answer any questions below. Nothing is saved until you approve it.</p>
              {reading.questions.length > 0 && (
                <ul className="list-disc space-y-1 rounded-xl bg-sky-brand-light/40 py-2.5 pl-8 pr-3 text-sm text-navy-700" aria-label="Open questions">
                  {reading.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              )}
              <Section title="Route and dates">
                <Choice id="frTripType" label="Trip" v={draft.tripType} options={TRIP_TYPES} error={err("tripType")}
                  on={(x) => set({ tripType: x as FlightRequestDraft["tripType"], ...(x !== "Return" ? { returnOn: "", returnTime: "" } : {}), ...(x !== "Multi-city" ? { legs: [] } : {}) })} />
                <Text id="frOrigin" label="From" v={draft.origin} on={(x) => set({ origin: x })} error={err("origin")} upper />
                <Text id="frDestination" label="To" v={draft.destination} on={(x) => set({ destination: x })} error={err("destination")} upper />
                <Text id="frDepart" label="Departure" type="date" v={draft.departOn} on={(x) => set({ departOn: x })} error={err("departOn")} />
                {draft.tripType === "Return" && <Text id="frReturn" label="Return" type="date" v={draft.returnOn} on={(x) => set({ returnOn: x })} error={err("returnOn")} />}
                <Choice id="frFlex" label="Date flexibility" v={draft.flexibleDays} error={err("flexibleDays")} on={(x) => set({ flexibleDays: x })}
                  options={["", "0", "1", "2", "3", "7"]} labels={{ "": "Not stated", "0": "Exact dates", "1": "± 1 day", "2": "± 2 days", "3": "± 3 days", "7": "± 7 days" }} />
              </Section>
              {draft.tripType === "Multi-city" && (
                <div className="space-y-2" aria-label="Further flights">
                  {draft.legs.map((l, i) => (
                    <LegRow key={i} n={i + 2} leg={l} on={(patch) => set({ legs: draft.legs.map((x, j) => (j === i ? { ...x, ...patch } : x)) })} remove={() => set({ legs: draft.legs.filter((_, j) => j !== i) })} />
                  ))}
                  {err("legs") && <p className="text-xs font-medium text-rose-600">{err("legs")}</p>}
                  {draft.legs.length < MAX_EXTRA_LEGS && (
                    <button type="button" onClick={() => set({ legs: [...draft.legs, { origin: draft.legs.at(-1)?.destination ?? draft.destination, destination: "", departOn: "" }] })} className="rounded-lg border border-navy-100 px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
                      Add a flight
                    </button>
                  )}
                </div>
              )}
              <Section title="Passengers and cabin">
                <Text id="frAdults" label="Adults (12+)" v={draft.adults} on={(x) => set({ adults: x })} error={err("adults")} />
                <Text id="frChildren" label="Children (2–11)" v={draft.children} on={(x) => set({ children: x })} error={err("children")} />
                <Text id="frInfants" label="Infants (under 2)" v={draft.infants} on={(x) => set({ infants: x })} error={err("infants")} />
                <Choice id="frCabin" label="Cabin" v={draft.cabin} options={CABINS} error={err("cabin")} on={(x) => set({ cabin: x as FlightRequestDraft["cabin"] })} />
              </Section>
              <Section title="Connections and times">
                <Choice id="frStops" label="Stops" v={draft.stops} options={STOPS} labels={{ "": "Not stated" }} error={err("stops")} on={(x) => set({ stops: x as FlightRequestDraft["stops"] })} />
                <Text id="frVia" label="Connect via" v={draft.via} on={(x) => set({ via: x })} error={err("via")} upper />
                <Text id="frConnection" label="Max connection (hours)" v={draft.maxConnectionHours} on={(x) => set({ maxConnectionHours: x })} error={err("maxConnectionHours")} />
                <Text id="frAirlines" label="Preferred airlines" v={draft.preferredAirlines} on={(x) => set({ preferredAirlines: x })} error={err("preferredAirlines")} upper />
                <Text id="frDepartTime" label="Departure time" v={draft.departTime} on={(x) => set({ departTime: x })} error={err("departTime")} list="frTimes" />
                {draft.tripType === "Return" && <Text id="frReturnTime" label="Return time" v={draft.returnTime} on={(x) => set({ returnTime: x })} error={err("returnTime")} list="frTimes" />}
                <datalist id="frTimes">
                  {[...TIME_SLOTS.filter(Boolean), "After 18:00", "Before 12:00"].map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Section>
              <Section title="Baggage, fare conditions and budget">
                <Choice id="frBaggage" label="Baggage needed" v={draft.baggage} options={BAGGAGE} labels={{ "": "Not stated" }} error={err("baggage")}
                  on={(x) => set({ baggage: x as FlightRequestDraft["baggage"], ...(x !== "Checked bags" ? { checkedBags: "" } : {}) })} />
                {draft.baggage === "Checked bags" && <Text id="frBags" label="Checked bags" v={draft.checkedBags} on={(x) => set({ checkedBags: x })} error={err("checkedBags")} />}
                <Text id="frBagNote" label="Baggage note" v={draft.baggageNote} on={(x) => set({ baggageNote: x })} error={err("baggageNote")} />
                <Text id="frBudget" label="Budget (your own figure)" v={draft.budgetAmount} on={(x) => set({ budgetAmount: x })} error={err("budgetAmount")} />
                <Text id="frCurrency" label="Currency" v={draft.budgetCurrency} on={(x) => set({ budgetCurrency: x })} error={err("budgetCurrency")} upper />
              </Section>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-navy-700">Fare conditions the customer asked for</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {FARE_RULES.map((r) => {
                    const chosen = draft.fareRules.split(",").map((x) => x.trim()).filter(Boolean);
                    return (
                      <label key={r} className="flex items-center gap-2 text-sm text-navy-700">
                        <input type="checkbox" checked={chosen.includes(r)} onChange={(e) => set({ fareRules: (e.target.checked ? [...chosen, r] : chosen.filter((x) => x !== r)).join(", ") })} className="size-4 accent-navy-900" />
                        {r}
                      </label>
                    );
                  })}
                </div>
                {err("fareRules") && <p className="text-xs font-medium text-rose-600">{err("fareRules")}</p>}
              </fieldset>
              <Field id="frNotes" label="Other requests (one per line)" error={err("notes")}>
                <textarea id="frNotes" rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} className={inputClass(!!err("notes"), "min-h-16 resize-y py-2.5")} />
              </Field>
              <p className="text-xs text-navy-400">Baggage and fare conditions are what the customer asked for, not confirmed allowances or rules: those come with a quoted fare.</p>
              <LinkSelect value={link} onChange={setLink} leads={leads} customers={customers} />
              <label className={cn("flex items-start gap-3 rounded-xl border p-3.5 text-sm", submitted && !reviewed ? "border-rose-300 bg-rose-50" : reviewed ? "border-emerald-300 bg-emerald-50/60" : "border-navy-100")}>
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-navy-900" />
                <span className="text-navy-700">I&apos;ve reviewed these details and approve saving them as a flight search.</span>
              </label>
              {submitted && !reviewed && <p className="text-xs font-medium text-rose-600">Confirm you&apos;ve reviewed the details first.</p>}
              {message && <p className="text-sm text-rose-600">{message}</p>}
              <p className="text-xs text-navy-400">Saved as a search request only. No live flight supplier is connected, so it isn&apos;t searched and no fares are shown.</p>
              <div className="flex gap-2">
                <button onClick={save} disabled={busy} className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60">
                  {busy ? "Saving…" : "Save search"}
                </button>
                <button onClick={discard} disabled={busy} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
                  Discard
                </button>
              </div>
            </>
          )
        )}
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-navy-700">{title}</legend>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</div>
    </fieldset>
  );
}

function Text({ id, label, v, on, error, type, upper, list }: { id: string; label: string; v: string; on: (v: string) => void; error?: string; type?: string; upper?: boolean; list?: string }) {
  return (
    <Field id={id} label={label} error={error}>
      <input id={id} type={type ?? "text"} value={v} list={list} onChange={(e) => on(e.target.value)} className={inputClass(!!error, cn("h-11", upper && "uppercase"))} />
    </Field>
  );
}

function Choice({ id, label, v, on, options, labels, error }: { id: string; label: string; v: string; on: (v: string) => void; options: readonly string[]; labels?: Record<string, string>; error?: string }) {
  return (
    <Field id={id} label={label} error={error}>
      <select id={id} value={v} onChange={(e) => on(e.target.value)} className={inputClass(!!error, "h-11")}>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </Field>
  );
}

function LegRow({ n, leg, on, remove }: { n: number; leg: Leg; on: (patch: Partial<Leg>) => void; remove: () => void }) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-end gap-3">
      <Text id={`frLeg${n}From`} label={`Flight ${n}: from`} v={leg.origin} on={(x) => on({ origin: x })} upper />
      <Text id={`frLeg${n}To`} label="To" v={leg.destination} on={(x) => on({ destination: x })} upper />
      <Text id={`frLeg${n}Date`} label="Date" type="date" v={leg.departOn} on={(x) => on({ departOn: x })} />
      <button type="button" onClick={remove} aria-label={`Remove flight ${n}`} className="mb-1 rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 hover:bg-navy-50">
        Remove
      </button>
    </div>
  );
}

function LinkSelect({ value, onChange, leads, customers }: { value: string; onChange: (v: string) => void; leads: { id: string; name: string; stage: string }[]; customers: { id: string; name: string }[] }) {
  return (
    <Field id="frLink" label="Link to (optional, stays in the CRM)">
      <select id="frLink" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass(false, "h-11")}>
        <option value="">Not linked</option>
        <optgroup label="Leads">
          {leads.filter((l) => l.stage !== "Lost").map((l) => (
            <option key={l.id} value={`lead:${l.id}`}>{l.id} · {l.name}</option>
          ))}
        </optgroup>
        <optgroup label="Customers">
          {customers.map((c) => (
            <option key={c.id} value={`customer:${c.id}`}>{c.id} · {c.name}</option>
          ))}
        </optgroup>
      </select>
    </Field>
  );
}
