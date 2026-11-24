"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { getLeadActivity, logLeadActivity } from "@/lib/actions/lead-activity";
import { describeActivity, LOG_TYPES, validateActivity, type ActivityValues, type LeadActivityEntry, type LogType } from "@/lib/lead-activity-rules";
import { Field, fieldA11y, inputClass } from "@/components/ui/form";
import { Icon, type IconName } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { cn, formatDate } from "@/lib/format";

const ICON: Record<string, IconName> = {
  Call: "bell",
  WhatsApp: "chat",
  Email: "document",
  Meeting: "users",
  Note: "document",
  "Stage change": "arrowRight",
  Quotation: "document",
};

/** The lead's activity log (newest first) and a small form to log a call, message, meeting or note. */
export function LeadActivity({ leadDbId, today }: { leadDbId: string; today: string | null }) {
  const toast = useToast();
  const [entries, setEntries] = useState<LeadActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ActivityValues>({ type: "Call", body: "", nextFollowUp: "" });
  const [submitted, setSubmitted] = useState(false);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    let live = true;
    void getLeadActivity(leadDbId).then((r) => {
      if (!live) return;
      if (r.ok) setEntries(r.entries);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [leadDbId]);

  const errors = today ? validateActivity(v, today) : {};
  const err = (k: keyof ActivityValues) => (submitted ? errors[k] : undefined);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    startSaving(async () => {
      const r = await logLeadActivity(leadDbId, v);
      if (!r.ok) {
        toast({ tone: "info", message: <p>{r.message}</p> });
        return;
      }
      setEntries(r.entries);
      setV({ type: v.type, body: "", nextFollowUp: "" });
      setSubmitted(false);
      setOpen(false);
      toast({ message: <p>{v.type} logged.</p> });
    });
  }

  return (
    <div className="space-y-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
          <Icon name="plus" size={16} /> Log activity
        </button>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-navy-100 p-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What happened">
            {LOG_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={v.type === t}
                onClick={() => setV({ ...v, type: t as LogType })}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold",
                  v.type === t ? "bg-navy-900 text-white" : "bg-navy-50 text-navy-600 hover:bg-navy-100",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <Field id="actBody" label="What was said or agreed" required error={err("body")}>
            <textarea
              {...fieldA11y("actBody", { error: err("body") })}
              rows={3}
              maxLength={1000}
              value={v.body}
              onChange={(e) => setV({ ...v, body: e.target.value })}
              className={inputClass(!!err("body"), "py-2")}
            />
          </Field>
          <Field id="actNext" label="Next follow-up" error={err("nextFollowUp")}>
            <input
              {...fieldA11y("actNext", { error: err("nextFollowUp") })}
              type="date"
              min={today ?? undefined}
              value={v.nextFollowUp}
              onChange={(e) => setV({ ...v, nextFollowUp: e.target.value })}
              className={inputClass(!!err("nextFollowUp"))}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-navy-100 px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || !today} className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {error ? (
        <p className="text-sm text-rose-700">{error}</p>
      ) : entries === null ? (
        <p className="text-sm text-navy-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-navy-400">Nothing logged yet.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", a.type === "Stage change" ? "bg-gold-50 text-gold-700" : "bg-navy-50 text-navy-600")}>
                <Icon name={ICON[a.type] ?? "document"} size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-navy-700">
                  <span className="font-semibold text-navy-900">{a.type}</span>
                  {describeActivity(a) && <> · {describeActivity(a)}</>}
                </p>
                <p className="text-xs text-navy-400">
                  {a.by} · {formatDate(a.at)} {a.at.slice(11, 16)} UTC
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
