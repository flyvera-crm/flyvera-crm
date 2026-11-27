"use client";

// Archive (with confirmation) and the admins' "Archived" list with Restore.
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { archiveRecord, listArchived, restoreRecord, type ArchivedRow, type ArchiveKind } from "@/lib/actions/archive";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { cn, formatDate } from "@/lib/format";
import { callAction } from "@/lib/action-call";

const LIST: Record<ArchiveKind, { href: string; noun: string; plural: string; detail: (code: string) => string }> = {
  customer: { href: "/customers", noun: "customer", plural: "customers", detail: (c) => `/customers/${c}` },
  lead: { href: "/leads", noun: "lead", plural: "leads", detail: () => "/leads" },
  quotation: { href: "/quotations", noun: "quotation", plural: "quotations", detail: (c) => `/quotations/${c}` },
};

/** Archives one record after confirmation, then goes back to the list. */
export function ArchiveButton({ kind, dbId, name, className, onArchived }: { kind: ArchiveKind; dbId: string; name: string; className?: string; onArchived?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, startBusy] = useTransition();
  const { href, noun } = LIST[kind];

  function confirm() {
    startBusy(async () => {
      // A failed request (network, redeploy) becomes a message instead of a crash; answers are unchanged.
      const r = await callAction(() => archiveRecord(kind, dbId), "Archive");
      toast({ tone: r.ok ? undefined : "info", message: <p>{r.message}</p> });
      setOpen(false);
      if (!r.ok) return;
      onArchived?.();
      if (kind !== "lead") router.push(href);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl border border-navy-100 bg-white px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50",
          className,
        )}
      >
        <Icon name="close" size={16} /> Archive
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Archive ${name}?`}
        description={`The ${noun} disappears from everyone's lists and searches. Nothing is deleted: an admin can restore it from the Archived list.`}
        footer={
          <>
            <button onClick={() => setOpen(false)} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
              Cancel
            </button>
            <button onClick={confirm} disabled={busy} className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
              {busy ? "Archiving…" : "Archive"}
            </button>
          </>
        }
      />
    </>
  );
}

/** Admins: the archived records of one kind, with Restore. */
export function ArchivedListButton({ kind }: { kind: ArchiveKind }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const { plural, detail } = LIST[kind];

  useEffect(() => {
    if (!open) return;
    let live = true;
    void listArchived(kind).then((r) => {
      if (!live) return;
      if (r.ok) setRows(r.rows);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [open, kind]);

  function restore(row: ArchivedRow) {
    startBusy(async () => {
      const r = await restoreRecord(kind, row.dbId);
      toast({ tone: r.ok ? undefined : "info", message: <p>{r.message}</p> });
      if (r.ok) setRows((list) => (list ?? []).filter((x) => x.dbId !== row.dbId));
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRows(null);
          setError(null);
          setOpen(true);
        }}
        className="flex items-center gap-2 rounded-xl border border-navy-100 bg-white px-4 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50"
      >
        <Icon name="clock" size={16} /> Archived
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Archived ${plural}`}
        description="Hidden from everyone except admins. Restoring brings a record back to its owner's lists."
        footer={
          <button onClick={() => setOpen(false)} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
            Close
          </button>
        }
      >
        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : rows === null ? (
          <p className="text-sm text-navy-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-navy-400">Nothing archived.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-navy-50 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.dbId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-navy-900">{r.label || r.code}</span>
                  <span className="text-xs text-navy-400">
                    {kind === "lead" ? r.code : <Link href={detail(r.code)} className="font-mono hover:text-sky-brand-dark">{r.code}</Link>} · archived{" "}
                    {r.archivedOn ? formatDate(r.archivedOn) : ""}
                  </span>
                </span>
                <button
                  disabled={busy}
                  onClick={() => restore(r)}
                  className="shrink-0 rounded-lg bg-navy-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
