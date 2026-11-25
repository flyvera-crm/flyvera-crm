"use client";

import Link from "next/link";
import type { Customer, Lead } from "@/types/crm";
import { useCustomers } from "@/components/customers/CustomersProvider";
import { useLeadList } from "@/lib/lead-store";
import { useQuoteData, useQuotations } from "@/lib/quote-store";
import type { AgentOption } from "@/lib/data/team";
import { todayIso } from "@/lib/dates";
import { emptyQuoteForm, newItem, quoteToForm, type QuoteFormValues } from "@/lib/quote-validation";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/icons";
import { QuoteBuilder } from "./QuoteBuilder";
import { useQuoteActions } from "./quote-actions";
import { useAgencySettings } from "@/lib/settings-store";
import type { AgencyDefaults } from "@/lib/settings-rules";

/** Starting values for a new quotation, pre-filled from a lead or customer when given. */
function prefill(
  today: string,
  defaults: AgencyDefaults,
  agents: AgentOption[],
  defaultAgentId: string,
  lead?: Lead,
  customer?: Customer,
): QuoteFormValues {
  // "Prepared by": the lead's / customer's agent when this user may pick them, else the user.
  const agentFor = (userId?: string) => (userId && agents.some((a) => a.id === userId) ? userId : defaultAgentId);
  const base = { ...emptyQuoteForm(today, defaults), agent: defaultAgentId };
  if (lead) {
    const future = (d?: string) => (d && d >= today ? d : "");
    const nights =
      lead.departDate && lead.returnDate ? Math.round((Date.parse(lead.returnDate) - Date.parse(lead.departDate)) / 86_400_000) : 0;
    const travellers = String(lead.travellers);
    return {
      ...base,
      // A lead that's already a customer is quoted as the customer.
      recipient: lead.customerId ? `customer:${lead.customerId}` : `lead:${lead.id}`,
      title: `${lead.tripType} in ${lead.destination}`,
      destination: lead.destination,
      departDate: future(lead.departDate),
      returnDate: future(lead.returnDate),
      adults: travellers,
      agent: agentFor(lead.agentId),
      items: [
        newItem("i1", "Flight", `Return flights to ${lead.destination}`, travellers),
        newItem("i2", "Hotel", nights ? `${nights} nights accommodation` : "Accommodation", "1"),
      ],
    };
  }
  if (customer) return { ...base, recipient: `customer:${customer.id}`, agent: agentFor(customer.agentId) };
  return base;
}

export function QuoteEditor({
  mode,
  quoteId,
  leadId,
  customerId,
}: {
  mode: "add" | "edit";
  quoteId?: string;
  leadId?: string;
  customerId?: string;
}) {
  const { customers, hydrated } = useCustomers();
  const leads = useLeadList();
  const { quotes } = useQuotations();
  const { access } = useQuoteData();
  const settings = useAgencySettings();
  const { duplicate } = useQuoteActions();

  // "Today" (for validity dates) is the visitor's own date, only known after hydration.
  if (!hydrated) return <EditorSkeleton />;
  const today = todayIso();

  if (!access.canEdit) {
    return (
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <Icon name="document" size={28} className="text-navy-300" />
        <h1 className="mt-4 text-xl font-semibold text-navy-900">Your role can view quotations but not create or edit them</h1>
        <p className="mt-2 max-w-md text-sm text-navy-400">Ask the sales agent who prepared it, or an admin.</p>
        <Link href="/quotations" className="mt-6 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
          All quotations
        </Link>
      </Card>
    );
  }

  if (mode === "edit") {
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) return <Missing id={quoteId ?? ""} />;
    if (quote.status === "Accepted" || quote.status === "Declined") {
      return (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <Icon name="document" size={28} className="text-navy-300" />
          <h1 className="mt-4 text-xl font-semibold text-navy-900">
            {quote.id} was {quote.status.toLowerCase()} and can&apos;t be changed
          </h1>
          <p className="mt-2 max-w-md text-sm text-navy-400">Make a copy to create a revised quotation instead.</p>
          <div className="mt-6 flex gap-2">
            <Link href={`/quotations/${quote.id}`} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
              View quotation
            </Link>
            <button onClick={() => duplicate(quote)} className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
              Duplicate as new draft
            </button>
          </div>
        </Card>
      );
    }
    return (
      <>
        <PageHeader
          eyebrow={`Quotation ${quote.id}`}
          title={`Edit: ${quote.title}`}
          description={`For ${quote.recipient.name}. Changes are saved when you press “Save changes”.`}
        />
        <QuoteBuilder
          mode="edit"
          existing={quote}
          initialValues={quoteToForm(quote)}
          customers={customers}
          leads={leads}
          agentOptions={
            quote.agentId && !access.agentOptions.some((a) => a.id === quote.agentId)
              ? [...access.agentOptions, { id: quote.agentId, name: quote.agent }]
              : access.agentOptions
          }
          today={today}
        />
      </>
    );
  }

  const lead = leadId ? leads.find((l) => l.id === leadId) : undefined;
  const customer = customerId ? customers.find((c) => c.id === customerId) : undefined;
  return (
    <>
      <PageHeader
        eyebrow="Quotations"
        title="New quotation"
        description={
          lead
            ? `Pre-filled from lead ${lead.id} (${lead.name}). Add prices for each item.`
            : customer
              ? `For ${customer.name}. Add the trip details and items.`
              : "Build a priced travel proposal. Totals and your margin update as you type."
        }
      />
      <QuoteBuilder
        mode="add"
        initialValues={prefill(today, settings.defaults, access.agentOptions, access.defaultAgentId, lead, customer)}
        customers={customers}
        leads={leads}
        agentOptions={access.agentOptions}
        today={today}
      />
    </>
  );
}

function Missing({ id }: { id: string }) {
  return (
    <Card className="flex flex-col items-center px-6 py-20 text-center">
      <Icon name="document" size={28} className="text-navy-300" />
      <h1 className="mt-4 text-xl font-semibold text-navy-900">Quotation not found</h1>
      <p className="mt-2 max-w-md text-sm text-navy-400">
        There&apos;s no quotation <span className="font-mono text-navy-700">{id}</span> that you can see. It may have been archived,
        or it belongs to a customer outside your team.
      </p>
      <Link href="/quotations" className="mt-6 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
        All quotations
      </Link>
    </Card>
  );
}

export function EditorSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-64 rounded-lg bg-navy-100" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="h-72 rounded-2xl bg-navy-50" />
          <div className="h-56 rounded-2xl bg-navy-50" />
        </div>
        <div className="h-80 rounded-2xl bg-navy-50" />
      </div>
    </div>
  );
}

export { Missing as QuoteMissing };
