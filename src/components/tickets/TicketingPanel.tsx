"use client";

// The booking page's Ticketing section: passengers → reservations & flights → tickets → documents.
// Data comes from the server (src/lib/data/ticketing.ts) for this booking only; every change goes
// through a Server Action (src/lib/actions/ticketing.ts) and the page refreshes with the saved state.
import { useRef, useState, useTransition, type ReactNode } from "react";
import type { Booking } from "@/types/crm";
import type { BookingTicketing, Passenger, Pnr, Segment, Ticket, TicketDocumentKind, TicketStatus } from "@/types/ticketing";
import * as server from "@/lib/actions/ticketing";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_KINDS, DOCUMENT_MAX_BYTES, DOCUMENT_MIME_TYPES, formatLocalDateTime } from "@/lib/ticketing-rules";
import { splitName } from "@/lib/lead-validation";
import { addDays } from "@/lib/customer-history";
import { useCustomers } from "@/components/customers/CustomersProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { cn, formatDate, formatMoney } from "@/lib/format";
import { IssueTicketModal, PassengerModal, PassportModal, PnrModal, SegmentModal, TicketChangeModal, VerifyPnrModal } from "./ticketing-modals";

const TICKET_TONE: Record<TicketStatus, BadgeTone> = { Issued: "success", Voided: "neutral", Refunded: "warning", Exchanged: "info" };
const PNR_TONE: Record<Pnr["status"], BadgeTone> = { Active: "info", Ticketed: "success", Cancelled: "danger", Expired: "neutral" };
/** Manual verification (separate from the PNR status above and from tickets). */
const VERIFICATION_TONE: Record<Pnr["verification"]["status"], BadgeTone> = { Pending: "warning", Verified: "success", "Not verified": "danger" };
const VERIFICATION_LABEL: Record<Pnr["verification"]["status"], string> = { Pending: "Not verified yet", Verified: "Verified", "Not verified": "Not verified" };

/** "Verified 27 Nov 2026 by Leo M. — Checked on the airline website" (or "Not checked yet"). */
function verificationSummary(v: Pnr["verification"]) {
  if (v.status === "Pending" || !v.at) return "Not checked with the airline or consolidator yet";
  return `${v.status} ${formatDate(v.at.slice(0, 10))}${v.by ? ` by ${v.by}` : ""}${v.notes ? ` — ${v.notes}` : ""}`;
}

type Dialog =
  | { kind: "passenger"; passenger?: Passenger; suggested?: Parameters<typeof PassengerModal>[0]["suggested"] }
  | { kind: "passport"; passenger: Passenger }
  | { kind: "pnr"; pnr?: Pnr }
  | { kind: "verify"; pnr: Pnr }
  | { kind: "segment"; segment?: Segment }
  | { kind: "ticket"; passengerId?: string }
  | { kind: "ticketChange"; ticket: Ticket };

export function TicketingPanel({ booking, data, today }: { booking: Booking; data: BookingTicketing; today: string | null }) {
  const toast = useToast();
  const { customers, getCustomer } = useCustomers();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, startBusy] = useTransition();
  const { access } = data;
  const closed = booking.status === "Cancelled" || booking.status === "Completed";
  const ticketable = booking.status === "Confirmed" || booking.status === "Ticketed";

  /** Runs a Server Action; shows its message when it refuses. Returns true when it worked. */
  async function run(action: Promise<server.ActionResult>, success?: string) {
    const result = await action;
    if (!result.ok) {
      toast({ tone: "info", message: <p>{result.message}</p> });
      return false;
    }
    if (success) toast({ message: <p>{success}</p> });
    return true;
  }

  const issuedFor = (passengerId: string) => data.tickets.filter((t) => t.passengerId === passengerId && t.status === "Issued");
  const customer = getCustomer(booking.customerId);
  const customerIsPassenger = data.passengers.some((p) => p.customerCode === booking.customerId);
  const travellers = booking.adults + booking.children;

  return (
    <div className="space-y-6" id="ticketing">
      {/* ── Passengers ── */}
      {access.canSeePassengers && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Passengers"
            subtitle={`${data.passengers.length} of ${travellers} traveller${travellers === 1 ? "" : "s"} added — names exactly as in each passport.`}
            action={
              access.canEditPassengers &&
              !closed && (
                <div className="flex shrink-0 gap-3">
                  {customer && !customerIsPassenger && (
                    <button
                      onClick={() =>
                        setDialog({
                          kind: "passenger",
                          suggested: {
                            ...splitName(customer.name),
                            dateOfBirth: customer.dateOfBirth ?? "",
                            nationality: customer.nationality ?? "",
                            customerCode: customer.id,
                            isLead: data.passengers.length === 0,
                          },
                        })
                      }
                      className="text-sm font-semibold text-sky-brand-dark hover:text-navy-900"
                    >
                      Add {customer.name.split(" ")[0]}
                    </button>
                  )}
                  <button onClick={() => setDialog({ kind: "passenger" })} className="inline-flex items-center gap-1 text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
                    <Icon name="plus" size={14} /> Add passenger
                  </button>
                </div>
              )
            }
          />
          {data.passengers.length ? (
            <ul className="mt-4 divide-y divide-navy-50 border-t border-navy-50">
              {data.passengers.map((p) => (
                <PassengerRow
                  key={p.id}
                  p={p}
                  issued={issuedFor(p.id)}
                  showTickets={access.canSeeTickets}
                  today={today}
                  canEdit={access.canEditPassengers && !closed}
                  canRemove={access.canRemovePassengers && !closed}
                  canIssue={access.canManage && ticketable && data.pnrs.length > 0}
                  onEdit={() => setDialog({ kind: "passenger", passenger: p })}
                  onPassport={() => setDialog({ kind: "passport", passenger: p })}
                  onIssue={() => setDialog({ kind: "ticket", passengerId: p.id })}
                  onRemove={() => {
                    if (window.confirm(`Remove ${p.firstName} ${p.lastName} from this booking?`))
                      startBusy(async () => void (await run(server.removePassenger(data.bookingDbId, p.id), "Passenger removed.")));
                  }}
                  busy={busy}
                />
              ))}
            </ul>
          ) : (
            <p className="px-5 py-5 text-sm text-navy-400 sm:px-6">No passengers yet. Add everyone travelling before tickets are issued.</p>
          )}
        </Card>
      )}

      {/* ── Reservations & flights ── */}
      {access.canSeeTravelRecords && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Reservations & flights"
            subtitle="PNRs from the GDS or airline, and each flight leg (airport local times)."
            action={
              access.canManage &&
              !closed && (
                <div className="flex shrink-0 gap-3">
                  <button onClick={() => setDialog({ kind: "pnr" })} className="inline-flex items-center gap-1 text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
                    <Icon name="plus" size={14} /> PNR
                  </button>
                  <button onClick={() => setDialog({ kind: "segment" })} className="inline-flex items-center gap-1 text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
                    <Icon name="plus" size={14} /> Flight
                  </button>
                </div>
              )
            }
          />
          {data.pnrs.length === 0 && data.segments.length === 0 ? (
            <p className="px-5 py-5 text-sm text-navy-400 sm:px-6">No reservations yet.</p>
          ) : (
            <div className="mt-4 space-y-4 border-t border-navy-50 p-5 sm:px-6">
              {data.pnrs.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {data.pnrs.map((r) => {
                    const deadlineSoon = r.status === "Active" && r.ticketingDeadline && today && r.ticketingDeadline.slice(0, 10) <= addDays(today, 2);
                    return (
                      <li key={r.id} className="flex items-center gap-1">
                        <button
                          onClick={() => access.canManage && !closed && setDialog({ kind: "pnr", pnr: r })}
                          disabled={!access.canManage || closed}
                          className="flex items-center gap-2 rounded-xl border border-navy-100 px-3 py-2 text-left text-sm enabled:hover:bg-navy-50"
                        >
                          <span className="font-mono font-semibold text-navy-900">{r.recordLocator}</span>
                          {r.airline && <span className="font-mono text-xs text-navy-500">{r.airline}</span>}
                          <span className="text-xs text-navy-400">{r.provider}</span>
                          <Badge tone={PNR_TONE[r.status]}>{r.status}</Badge>
                          <span title={verificationSummary(r.verification)}>
                            <Badge tone={VERIFICATION_TONE[r.verification.status]}>{VERIFICATION_LABEL[r.verification.status]}</Badge>
                          </span>
                          {r.ticketingDeadline && r.status === "Active" && (
                            <span className={cn("text-xs", deadlineSoon ? "font-semibold text-rose-600" : "text-navy-400")}>
                              ticket by {formatLocalDateTime(r.ticketingDeadline)}
                            </span>
                          )}
                        </button>
                        {access.canManage && !closed && (
                          <button
                            onClick={() => setDialog({ kind: "verify", pnr: r })}
                            aria-label={`Verify PNR ${r.recordLocator}`}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-sky-brand-dark hover:bg-navy-50 hover:text-navy-900"
                          >
                            Verify
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {data.segments.length > 0 && (
                <ul className="divide-y divide-navy-50 rounded-xl border border-navy-100">
                  {data.segments.map((s) => (
                    <li key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-navy-900">
                          <span className="font-mono">
                            {s.carrier}
                            {s.flightNumber}
                          </span>{" "}
                          · {s.origin} → {s.destination}
                          <span className="ml-2 text-xs font-normal text-navy-400">
                            {s.cabin}
                            {s.bookingClass && ` (${s.bookingClass})`}
                            {s.operatingCarrier && ` · operated by ${s.operatingCarrier}`}
                          </span>
                        </p>
                        <p className="text-xs text-navy-500">
                          {formatLocalDateTime(s.departsAt)} → {formatLocalDateTime(s.arrivesAt)}
                          {s.pnrId && <> · PNR {data.pnrs.find((r) => r.id === s.pnrId)?.recordLocator}</>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={s.status === "Cancelled" ? "danger" : s.status === "Waitlisted" ? "warning" : "info"}>{s.status}</Badge>
                        {access.canManage && !closed && (
                          <>
                            <button onClick={() => setDialog({ kind: "segment", segment: s })} className="rounded-lg px-2 py-1 text-xs font-medium text-navy-500 hover:bg-navy-50">
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm(`Remove flight ${s.carrier}${s.flightNumber}?`))
                                  startBusy(async () => void (await run(server.removeSegment(data.bookingDbId, s.id), "Flight removed.")));
                              }}
                              disabled={busy}
                              className="rounded-lg px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── Tickets ── */}
      {access.canSeeTickets && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Tickets"
            subtitle="Recorded from the airline or GDS after issue. Tickets are never deleted — void, refund or exchange them instead."
            action={
              access.canManage &&
              ticketable &&
              data.passengers.length > 0 &&
              data.pnrs.length > 0 && (
                <button onClick={() => setDialog({ kind: "ticket" })} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
                  <Icon name="plus" size={14} /> Record issued ticket
                </button>
              )
            }
          />
          {access.canManage && !ticketable && !closed && (
            <p className="mx-5 mt-4 rounded-xl bg-navy-50 px-3.5 py-2.5 text-xs text-navy-500 sm:mx-6">
              Tickets can be recorded once the booking is confirmed (deposit received).
            </p>
          )}
          {data.tickets.length ? (
            <ul className="mt-4 divide-y divide-navy-50 border-t border-navy-50">
              {data.tickets.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="min-w-0">
                    <p className="font-medium text-navy-900">
                      <span className="font-mono">{t.ticketNumber}</span> <span className="text-sm font-normal text-navy-500">· {t.passengerName}</span>
                    </p>
                    <p className="text-xs text-navy-400">
                      {t.airline} · issued {formatDate(t.issuedAt)} · {formatMoney(t.total)} ({formatMoney(t.baseFare)} + {formatMoney(t.taxes)} tax)
                      {" · "}
                      <span title={t.supplierReference ? `Supplier reference ${t.supplierReference}` : undefined}>
                        {t.numberSource === "Supplier API" ? "from supplier connection" : "copied from supplier e-ticket"}
                        {t.supplierReference && <> · ref {t.supplierReference}</>}
                      </span>
                      {t.voidedAt && <> · voided {formatDate(t.voidedAt)}</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={TICKET_TONE[t.status]}>{t.status}</Badge>
                    {access.canManage && t.status === "Issued" && (
                      <button onClick={() => setDialog({ kind: "ticketChange", ticket: t })} className="rounded-lg px-2 py-1 text-xs font-medium text-navy-500 hover:bg-navy-50">
                        Void / refund / exchange
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-5 text-sm text-navy-400 sm:px-6">No tickets recorded yet.</p>
          )}
        </Card>
      )}

      {/* ── Documents ── */}
      {access.canSeeTickets && <DocumentsCard data={data} canManage={access.canManage} run={run} />}

      {/* ── Dialogs ── */}
      {dialog?.kind === "passenger" && today && (
        <PassengerModal
          passenger={dialog.passenger}
          suggested={dialog.suggested}
          customers={customers}
          today={today}
          onClose={() => setDialog(null)}
          onSave={(v) =>
            run(server.savePassenger(data.bookingDbId, dialog.passenger?.id ?? null, v), dialog.passenger ? "Passenger saved." : `${v.firstName} ${v.lastName} added.`)
          }
        />
      )}
      {dialog?.kind === "passport" && today && (
        <PassportModal
          passenger={dialog.passenger}
          today={today}
          onClose={() => setDialog(null)}
          onSave={(v) => run(server.setPassengerPassport(dialog.passenger.id, v), "Travel document saved (encrypted).")}
          onCopy={
            dialog.passenger.customerCode
              ? () => run(server.copyCustomerPassport(dialog.passenger.id, dialog.passenger.customerCode), "Saved passport copied.")
              : undefined
          }
        />
      )}
      {dialog?.kind === "pnr" && (
        <PnrModal pnr={dialog.pnr} onClose={() => setDialog(null)} onSave={(v) => run(server.savePnr(data.bookingDbId, dialog.pnr?.id ?? null, v), "Reservation saved.")} />
      )}
      {dialog?.kind === "verify" && (
        <VerifyPnrModal
          pnr={dialog.pnr}
          onClose={() => setDialog(null)}
          onSave={(v) => run(server.verifyPnr(data.bookingDbId, dialog.pnr.id, v), `PNR ${dialog.pnr.recordLocator}: ${v.status.toLowerCase()}.`)}
        />
      )}
      {dialog?.kind === "segment" && (
        <SegmentModal
          segment={dialog.segment}
          pnrs={data.pnrs}
          onClose={() => setDialog(null)}
          onSave={(v) => run(server.saveSegment(data.bookingDbId, dialog.segment?.id ?? null, v), "Flight saved.")}
        />
      )}
      {dialog?.kind === "ticket" && today && (
        <IssueTicketModal
          passengers={data.passengers}
          pnrs={data.pnrs}
          preselectPassengerId={dialog.passengerId}
          today={today}
          bookingCreated={booking.created}
          onClose={() => setDialog(null)}
          onSave={(v) => run(server.issueTicket(data.bookingDbId, v), "Ticket recorded. It's in the booking's history and the audit log.")}
        />
      )}
      {dialog?.kind === "ticketChange" && (
        <TicketChangeModal
          ticket={dialog.ticket}
          onClose={() => setDialog(null)}
          onSave={(v) => run(server.changeTicketStatus(dialog.ticket.id, v.status, v.reason), `Ticket ${dialog.ticket.ticketNumber} marked ${v.status.toLowerCase()}.`)}
        />
      )}
    </div>
  );
}

/* ─────────────── passenger row ─────────────── */

function PassengerRow({
  p,
  issued,
  showTickets,
  today,
  canEdit,
  canRemove,
  canIssue,
  onEdit,
  onPassport,
  onIssue,
  onRemove,
  busy,
}: {
  p: Passenger;
  issued: Ticket[];
  showTickets: boolean;
  today: string | null;
  canEdit: boolean;
  canRemove: boolean;
  canIssue: boolean;
  onEdit: () => void;
  onPassport: () => void;
  onIssue: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, startReveal] = useTransition();
  const toast = useToast();
  const expired = p.documentExpiry && today && p.documentExpiry <= today;
  const expiresSoon = p.documentExpiry && today && !expired && p.documentExpiry < addDays(today, 182);

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-navy-900">
          {p.title && <span className="text-navy-500">{p.title}</span>} {p.firstName} {p.lastName}
          <span className="text-xs font-normal text-navy-400">{p.type}</span>
          {p.isLead && <Badge tone="gold">Lead</Badge>}
          {p.customerCode && <span className="font-mono text-xs text-navy-400">{p.customerCode}</span>}
        </p>
        <p className="mt-0.5 text-xs text-navy-500">
          {p.documentLast4 ? (
            <>
              {p.documentType ?? "Passport"} <span className="font-mono">{revealed ?? `•••••${p.documentLast4}`}</span>
              {p.documentIssuingCountry && <> · {p.documentIssuingCountry}</>}
              {p.documentExpiry && (
                <span className={cn(expired ? "font-semibold text-rose-600" : expiresSoon ? "font-semibold text-amber-700" : undefined)}>
                  {" "}
                  · expires {formatDate(p.documentExpiry)}
                  {expired ? " (expired)" : expiresSoon ? " (under 6 months)" : ""}
                </span>
              )}
              {canEdit && (
                <button
                  disabled={revealing}
                  onClick={() => {
                    if (revealed) return setRevealed(null);
                    startReveal(async () => {
                      const r = await server.revealPassengerPassport(p.id);
                      if (r.ok) setRevealed(r.number);
                      else toast({ tone: "info", message: <p>{r.message}</p> });
                    });
                  }}
                  className="ml-2 font-medium text-sky-brand-dark hover:underline"
                  title="Each time the full number is shown, it's recorded in the audit log."
                >
                  {revealing ? "…" : revealed ? "Hide" : "Show"}
                </button>
              )}
            </>
          ) : (
            <span className="text-amber-700">No travel document yet</span>
          )}
          {p.dateOfBirth && <> · born {formatDate(p.dateOfBirth)}</>}
        </p>
        {showTickets && (
          <p className="mt-0.5 text-xs">
            {issued.length ? (
              <span className="text-emerald-700">✓ Ticket {issued.map((t) => t.ticketNumber).join(", ")}</span>
            ) : (
              <span className="text-navy-400">No ticket yet</span>
            )}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {canIssue && issued.length === 0 && <SmallButton onClick={onIssue}>Record ticket</SmallButton>}
        {canEdit && <SmallButton onClick={onPassport}>{p.documentLast4 ? "Document" : "Add document"}</SmallButton>}
        {canEdit && <SmallButton onClick={onEdit}>Edit</SmallButton>}
        {canRemove && issued.length === 0 && (
          <SmallButton onClick={onRemove} danger disabled={busy}>
            Remove
          </SmallButton>
        )}
      </div>
    </li>
  );
}

function SmallButton({ onClick, children, danger, disabled }: { onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50",
        danger ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-navy-100 text-navy-600 hover:bg-navy-50",
      )}
    >
      {children}
    </button>
  );
}

/* ─────────────── documents ─────────────── */

function DocumentsCard({
  data,
  canManage,
  run,
}: {
  data: BookingTicketing;
  canManage: boolean;
  run: (action: Promise<server.ActionResult>, success?: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<TicketDocumentKind>("E-ticket");
  const [ticketId, setTicketId] = useState("");
  const [busy, startBusy] = useTransition();

  /** Uploads straight from the browser to the private bucket (storage access rules apply), then records it. */
  function upload(file: File) {
    if (!DOCUMENT_MIME_TYPES.includes(file.type) || file.size > DOCUMENT_MAX_BYTES) {
      toast({ tone: "info", message: <p>Upload a PDF, PNG or JPEG of up to 20 MB.</p> });
      return;
    }
    startBusy(async () => {
      const safeName = file.name.replace(/[^\w.-]+/g, "-").slice(-100);
      const path = `${data.organizationId}/${data.bookingDbId}/${crypto.randomUUID()}-${safeName}`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("ticket-documents").upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        toast({ tone: "info", message: <p>The file couldn&apos;t be uploaded. Only Ticketing or an admin can upload documents.</p> });
        return;
      }
      const ok = await run(
        server.recordTicketDocument(data.bookingDbId, { path, fileName: file.name, mimeType: file.type, size: file.size, kind, ticketId: ticketId || null }),
        `${kind} uploaded.`,
      );
      if (!ok) await supabase.storage.from("ticket-documents").remove([path]); // don't leave an orphan file
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function open(documentId: string) {
    startBusy(async () => {
      const r = await server.ticketDocumentUrl(documentId);
      if (!r.ok) toast({ tone: "info", message: <p>{r.message}</p> });
      else window.location.assign(r.url); // short-lived signed link
    });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Documents" subtitle="E-tickets, itineraries and vouchers — private files, opened through a 60-second link." />
      {canManage && (
        <div className="mt-4 flex flex-col gap-2 border-t border-navy-50 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
          <select value={kind} onChange={(e) => setKind(e.target.value as TicketDocumentKind)} aria-label="Document type" className={inputClass(false, "h-10 sm:w-40")}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <select value={ticketId} onChange={(e) => setTicketId(e.target.value)} aria-label="For ticket" className={inputClass(false, "h-10 sm:w-56")}>
            <option value="">Whole booking</option>
            {data.tickets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.ticketNumber} · {t.passengerName}
              </option>
            ))}
          </select>
          <label className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800", busy && "pointer-events-none opacity-60")}>
            <Icon name="plus" size={15} className="text-gold-300" /> {busy ? "Uploading…" : "Upload file"}
            <input
              ref={fileRef}
              type="file"
              accept={DOCUMENT_MIME_TYPES.join(",")}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
          </label>
        </div>
      )}
      {data.documents.length ? (
        <ul className="divide-y divide-navy-50 border-t border-navy-50">
          {data.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
              <button onClick={() => open(d.id)} disabled={busy} className="min-w-0 text-left">
                <span className="block truncate text-sm font-medium text-sky-brand-dark hover:underline">{d.fileName}</span>
                <span className="text-xs text-navy-400">
                  {d.kind} · {(d.sizeBytes / 1024).toFixed(0)} KB · {formatDate(d.uploadedOn)}
                  {d.ticketId && <> · ticket {data.tickets.find((t) => t.id === d.ticketId)?.ticketNumber}</>}
                </span>
              </button>
              {canManage && (
                <button
                  onClick={() => {
                    if (window.confirm(`Remove ${d.fileName}?`)) startBusy(async () => void (await run(server.removeTicketDocument(data.bookingDbId, d.id), "Document removed.")));
                  }}
                  disabled={busy}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-5 text-sm text-navy-400 sm:px-6">No documents uploaded yet.</p>
      )}
    </Card>
  );
}
