"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Lead, LeadStage } from "@/types/crm";
import { useLeadData } from "@/lib/lead-store";
import { saveLead } from "@/lib/actions/leads";
import { todayIso, useHydrated } from "@/lib/dates";
import { compactPhone } from "@/lib/customer-validation";
import { emptyLeadForm, leadToFormValues, splitName, type LeadFormValues } from "@/lib/lead-validation";
import { LOST_REASONS } from "@/config/lead-options";
import { useCustomers } from "@/components/customers/CustomersProvider";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { LeadForm, LEAD_FORM_ID, type LeadSubmitOutcome } from "./LeadForm";
import { LeadDetails } from "./LeadDetails";

type Panel = { type: "details"; id: string } | { type: "add" } | { type: "edit"; id: string };

type LeadsContextValue = {
  leads: Lead[];
  /** The visitor's date (YYYY-MM-DD) once hydrated; null during the server render. */
  today: string | null;
  /** Codes of leads created in this session (shown with a "New" tag). */
  addedIds: Set<string>;
  /** Admin and sales may edit and move leads; support may only add and read. */
  canEdit: boolean;
  openLead: (id: string) => void;
  openAddLead: () => void;
  moveLead: (id: string, stage: LeadStage) => void;
};

const LeadsContext = createContext<LeadsContextValue | null>(null);

export function useLeads() {
  const ctx = useContext(LeadsContext);
  if (!ctx) throw new Error("useLeads must be used inside <LeadsProvider>");
  return ctx;
}

/** Leads page state: the shared lead list (from Supabase) plus the details/add/edit panel and the "lost" dialog. */
export function LeadsProvider({ children }: { children: ReactNode }) {
  const { leads, access, updateLeadStatus, showSaved } = useLeadData();
  const hydrated = useHydrated();
  const today = hydrated ? todayIso() : null;
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [saving, startSaving] = useTransition();

  const { customers, openAddForm } = useCustomers();
  const toast = useToast();
  const router = useRouter();

  const [panel, setPanel] = useState<Panel | null>(null); // kept while the drawer slides out
  const [open, setOpen] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const dirtyRef = useRef(false);
  const [lostFor, setLostFor] = useState<Lead | null>(null);
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  // Lets toast buttons created earlier always call the latest convertLead.
  const convertRef = useRef<(lead: Lead) => void>(() => {});

  const getLead = useCallback((id: string) => leads.find((l) => l.id === id), [leads]);

  const showPanel = useCallback((next: Panel) => {
    dirtyRef.current = false;
    setPanelKey((k) => k + 1);
    setPanel(next);
    setOpen(true);
  }, []);
  const openLead = useCallback((id: string) => showPanel({ type: "details", id }), [showPanel]);
  const openAddLead = useCallback(() => {
    if (access.canCreate) showPanel({ type: "add" });
  }, [access.canCreate, showPanel]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirtyRef.current && !window.confirm("Discard your changes? Anything you typed will be lost.")) return;
    // From the edit form, go back to the lead's details instead of closing.
    if (panel?.type === "edit") return showPanel({ type: "details", id: panel.id });
    setOpen(false);
  }, [panel, saving, showPanel]);

  /** Saves a stage change and offers Undo (or "Convert" when won). */
  const applyMove = useCallback(
    async (lead: Lead, stage: LeadStage, reason?: string) => {
      const previous = lead;
      const result = await updateLeadStatus(lead, { stage, lostReason: stage === "Lost" ? (reason ?? null) : null });
      if (!result.ok) {
        toast({ tone: "info", message: <p>{result.message}</p> });
        return;
      }
      if (stage === "Won" && !lead.customerId) {
        toast({
          message: (
            <p>
              🎉 <span className="font-semibold">{lead.name}</span> is won! Create their customer profile now?
            </p>
          ),
          action: { label: "Convert to customer", onClick: () => convertRef.current(result.lead) },
        });
      } else {
        toast({
          tone: "info",
          message: (
            <p>
              <span className="font-semibold">{lead.name}</span> moved to <span className="font-semibold">{stage}</span>
              {stage === "Lost" && reason ? ` (${reason.toLowerCase()})` : ""}.
            </p>
          ),
          action: {
            label: "Undo",
            onClick: () =>
              void updateLeadStatus(result.lead, {
                stage: previous.stage,
                lostReason: previous.lostReason ?? null,
                nextFollowUp: previous.nextFollowUp ?? null,
                lastContact: previous.lastContact,
              }),
          },
        });
      }
    },
    [toast, updateLeadStatus],
  );

  const moveLead = useCallback(
    (id: string, stage: LeadStage) => {
      const lead = getLead(id);
      if (!lead || lead.stage === stage || !access.canEdit) return;
      if (stage === "Lost") {
        // Ask why first — the move only happens if they confirm.
        setLostReason(LOST_REASONS[0]);
        setLostFor(lead);
        return;
      }
      void applyMove(lead, stage);
    },
    [getLead, applyMove, access.canEdit],
  );

  /** Turns a lead into a customer (or links it to an existing one with the same phone). */
  const convertLead = useCallback(
    (lead: Lead) => {
      if (lead.customerId) return router.push(`/customers/${lead.customerId}`);
      const markConverted = async (customerCode: string) => {
        const result = await updateLeadStatus(lead, { customerCode, stage: "Won", lostReason: null, nextFollowUp: null });
        if (!result.ok) toast({ tone: "info", message: <p>The customer was saved, but the lead couldn&apos;t be linked: {result.message}</p> });
        return result.ok;
      };

      const existing = customers.find((c) => compactPhone(c.phone) === compactPhone(lead.phone));
      if (existing) {
        setOpen(false);
        void markConverted(existing.id).then((ok) => {
          if (!ok) return;
          toast({
            message: (
              <p>
                {lead.name} is already a customer — linked to <span className="font-semibold">{existing.name}</span> (
                <span className="font-mono text-gold-300">{existing.id}</span>).
              </p>
            ),
            action: { label: "View profile", onClick: () => router.push(`/customers/${existing.id}`) },
          });
        });
        return;
      }

      setOpen(false);
      openAddForm({
        context: `Converting lead ${lead.id} — check the details and add their city & country.`,
        initialValues: {
          ...splitName(lead.name),
          phone: lead.phone,
          email: lead.email ?? "",
          agent: lead.agentId ?? lead.agent,
          favouriteDestination: lead.destination,
          whatsappOptIn: lead.source === "WhatsApp",
          notes: lead.notes ?? "",
        },
        onSaved: (customer) => {
          void markConverted(customer.id).then((ok) => {
            if (!ok) return;
            toast({
              message: (
                <p>
                  <span className="font-semibold">{customer.name}</span> is now a customer (
                  <span className="font-mono text-gold-300">{customer.id}</span>).
                </p>
              ),
              action: { label: "View profile", onClick: () => router.push(`/customers/${customer.id}`) },
            });
          });
        },
      });
    },
    [customers, openAddForm, router, toast, updateLeadStatus],
  );
  useEffect(() => {
    convertRef.current = convertLead;
  });

  const handleSubmit = useCallback(
    (values: LeadFormValues) =>
      new Promise<LeadSubmitOutcome>((resolve) => {
        startSaving(async () => {
          const editing = panel?.type === "edit" ? getLead(panel.id) : undefined;
          if (panel?.type === "edit" && !editing) {
            resolve({ message: "This lead is no longer in your list." });
            return;
          }
          const result = await saveLead({ dbId: editing?.dbId }, values);
          if (!result.ok) {
            resolve({ message: result.message, fieldErrors: result.fieldErrors });
            return;
          }
          dirtyRef.current = false;
          const lead = result.lead;
          showSaved(lead);
          resolve(undefined);
          if (editing) {
            toast({ message: <p>Changes to <span className="font-semibold">{lead.name}</span> saved.</p> });
            showPanel({ type: "details", id: lead.id });
            return;
          }
          setAddedIds((ids) => new Set(ids).add(lead.id));
          toast({
            message: (
              <p>
                New lead <span className="font-semibold">{lead.name}</span> added as{" "}
                <span className="font-mono text-gold-300">{lead.id}</span>.
              </p>
            ),
            action: { label: "Open lead", onClick: () => openLead(lead.id) },
          });
          setOpen(false);
        });
      }),
    [panel, getLead, showSaved, toast, showPanel, openLead],
  );

  const value = useMemo(
    () => ({ leads, today, addedIds, canEdit: access.canEdit, openLead, openAddLead, moveLead }),
    [leads, today, addedIds, access.canEdit, openLead, openAddLead, moveLead],
  );

  const current = panel && panel.type !== "add" ? getLead(panel.id) : undefined;
  const isForm = panel?.type === "add" || panel?.type === "edit";

  return (
    <LeadsContext.Provider value={value}>
      {children}

      <Drawer
        open={open}
        onClose={requestClose}
        title={panel?.type === "add" ? "New lead" : panel?.type === "edit" ? "Edit lead" : (current?.name ?? "Lead")}
        description={
          panel?.type === "add"
            ? "Capture a new travel enquiry."
            : current && (
                <span>
                  <span className="font-mono">{current.id}</span> · {current.destination} · {current.travellers}{" "}
                  {current.travellers === 1 ? "traveller" : "travellers"}
                </span>
              )
        }
        footer={
          isForm ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={requestClose}
                disabled={saving}
                className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50 disabled:opacity-50"
              >
                {panel?.type === "edit" ? "Back" : "Cancel"}
              </button>
              <button
                type="submit"
                form={LEAD_FORM_ID}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-800 disabled:cursor-wait disabled:opacity-70"
              >
                <Icon name="check" size={16} className="text-gold-300" strokeWidth={2.5} />
                {saving ? "Saving…" : panel?.type === "edit" ? "Save changes" : "Save lead"}
              </button>
            </div>
          ) : undefined
        }
      >
        {panel?.type === "details" && current && (
          <LeadDetails
            key={panelKey}
            lead={current}
            today={today}
            canEdit={access.canEdit}
            onEdit={() => showPanel({ type: "edit", id: current.id })}
            onMove={(stage) => moveLead(current.id, stage)}
            onConvert={() => convertLead(current)}
          />
        )}
        {isForm && (
          <LeadForm
            key={panelKey}
            mode={panel.type === "edit" ? "edit" : "add"}
            leadId={panel.type === "edit" ? panel.id : null}
            initialValues={
              panel.type === "edit" && current
                ? leadToFormValues(current)
                : { ...emptyLeadForm, agent: access.defaultAgentId }
            }
            agentOptions={
              current?.agentId && panel.type === "edit" && !access.agentOptions.some((a) => a.id === current.agentId)
                ? [...access.agentOptions, { id: current.agentId, name: current.agent }]
                : access.agentOptions
            }
            otherLeads={panel.type === "edit" ? leads.filter((l) => l.id !== panel.id) : leads}
            customers={customers}
            today={todayIso()}
            onSubmit={handleSubmit}
            onDirty={() => {
              dirtyRef.current = true;
            }}
          />
        )}
      </Drawer>

      <Modal
        open={lostFor !== null}
        onClose={() => setLostFor(null)}
        title="Mark lead as lost"
        description={
          lostFor && (
            <>
              Why didn&apos;t <span className="font-semibold text-navy-900">{lostFor.name}</span> book? This helps spot patterns
              in Reports.
            </>
          )
        }
        footer={
          <>
            <button
              onClick={() => setLostFor(null)}
              className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (lostFor) void applyMove(lostFor, "Lost", lostReason);
                setLostFor(null);
              }}
              className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700"
            >
              Mark as lost
            </button>
          </>
        }
      >
        <label htmlFor="lostReason" className="mb-1.5 block text-sm font-medium text-navy-700">
          Reason
        </label>
        <div className="relative">
          <select
            id="lostReason"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            className={inputClass(false, "h-11 appearance-none pr-9")}
          >
            {LOST_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
        </div>
      </Modal>
    </LeadsContext.Provider>
  );
}
