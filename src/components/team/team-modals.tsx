"use client";

// Team dialogs: invite, change role, disable / re-enable (with hand-over of open work), team name.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { OpenWork, TeamGroup, TeamMember } from "@/types/team";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type AppRole } from "@/config/roles";
import { OPEN_WORK_LABELS, OWNER_ROLES, validateInvite, validateReason, validateTeamName, type InviteValues } from "@/lib/team-rules";
import { getOpenWork } from "@/lib/actions/team";
import { Modal } from "@/components/ui/Modal";
import { Field, fieldA11y, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";

function Footer({ onClose, form, label, danger, disabled }: { onClose: () => void; form: string; label: string; danger?: boolean; disabled?: boolean }) {
  return (
    <>
      <button onClick={onClose} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
        Cancel
      </button>
      <button
        type="submit"
        form={form}
        disabled={disabled}
        className={
          (danger ? "bg-rose-600 hover:bg-rose-700" : "bg-navy-900 hover:bg-navy-800") +
          " rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
        }
      >
        {label}
      </button>
    </>
  );
}

function Select({ id, value, onChange, error, children }: { id: string; value: string; onChange: (v: string) => void; error?: string; children: ReactNode }) {
  return (
    <div className="relative">
      <select {...fieldA11y(id, { error })} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass(!!error, "h-11 appearance-none pr-9")}>
        {children}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
    </div>
  );
}

function ReasonField({ id, value, onChange, error, placeholder }: { id: string; value: string; onChange: (v: string) => void; error?: string; placeholder: string }) {
  return (
    <Field id={id} label="Reason" required error={error} hint="Saved in the audit log.">
      <input {...fieldA11y(id, { error, hint: "Saved in the audit log." })} maxLength={200} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass(!!error)} />
    </Field>
  );
}

/* ── Invite ── */

export function InviteModal({ teams, onClose, onSave }: { teams: TeamGroup[]; onClose: () => void; onSave: (v: InviteValues) => void }) {
  const [v, setV] = useState<InviteValues>({ email: "", fullName: "", role: "", teamId: "" });
  const [submitted, setSubmitted] = useState(false);
  const errors = validateInvite(v);
  const err = (f: keyof InviteValues) => (submitted ? errors[f] : undefined);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    onSave(v);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite a team member"
      description="They get an email to choose a password. Access starts when they accept; the invitation expires after 14 days."
      footer={<Footer onClose={onClose} form="invite-form" label="Send invitation" />}
    >
      <form id="invite-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id="invName" label="Full name" required error={err("fullName")}>
          <input {...fieldA11y("invName", { error: err("fullName") })} value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} autoComplete="off" className={inputClass(!!err("fullName"))} />
        </Field>
        <Field id="invEmail" label="Work email" required error={err("email")}>
          <input {...fieldA11y("invEmail", { error: err("email") })} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="off" className={inputClass(!!err("email"))} />
        </Field>
        <Field id="invRole" label="Role" required error={err("role")} className="sm:col-span-2">
          <Select id="invRole" value={v.role} onChange={(role) => setV({ ...v, role: role as AppRole })} error={err("role")}>
            <option value="">Choose…</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          {v.role && <p className="mt-1.5 text-xs text-navy-500">{ROLE_DESCRIPTIONS[v.role]}</p>}
        </Field>
        {teams.length > 0 && (
          <Field id="invTeam" label="Team" className="sm:col-span-2">
            <Select id="invTeam" value={v.teamId} onChange={(teamId) => setV({ ...v, teamId })}>
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </Modal>
  );
}

/* ── Change role ── */

export function RoleModal({ member, onClose, onSave }: { member: TeamMember; onClose: () => void; onSave: (role: AppRole, reason: string) => void }) {
  const [role, setRole] = useState<AppRole>(member.role);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const roleError = role === member.role ? "Choose a different role." : undefined;
  const reasonError = validateReason(reason);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (roleError || reasonError) return;
    onSave(role, reason);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Change ${member.name}'s role`}
      description={`Currently ${ROLE_LABELS[member.role]}. The change applies the next time they load a page.`}
      footer={<Footer onClose={onClose} form="role-form" label="Change role" />}
    >
      <form id="role-form" onSubmit={submit} noValidate className="grid gap-4">
        <Field id="newRole" label="New role" required error={submitted ? roleError : undefined}>
          <Select id="newRole" value={role} onChange={(r) => setRole(r as AppRole)} error={submitted ? roleError : undefined}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-navy-500">{ROLE_DESCRIPTIONS[role]}</p>
        </Field>
        <ReasonField id="roleReason" value={reason} onChange={setReason} error={submitted ? reasonError : undefined} placeholder="e.g. Promoted to lead Team Horizon" />
      </form>
    </Modal>
  );
}

/* ── Disable / re-enable ── */

export function StatusModal({
  member,
  colleagues,
  onClose,
  onSave,
}: {
  member: TeamMember;
  /** Everyone else in the agency (filtered here to active admins and sales). */
  colleagues: TeamMember[];
  onClose: () => void;
  onSave: (reason: string, reassignTo: string) => void;
}) {
  const disabling = member.status === "active";
  const [reason, setReason] = useState("");
  const [reassignTo, setReassignTo] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [work, setWork] = useState<OpenWork | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);

  useEffect(() => {
    if (!disabling) return;
    let live = true;
    void getOpenWork(member.userId).then((r) => {
      if (!live) return;
      if (r.ok) setWork(r.work);
      else setWorkError(r.message);
    });
    return () => {
      live = false;
    };
  }, [disabling, member.userId]);

  const total = work ? Object.values(work).reduce((s, n) => s + n, 0) : 0;
  const owners = colleagues.filter((c) => c.status === "active" && c.userId !== member.userId && OWNER_ROLES.includes(c.role));
  const reasonError = validateReason(reason);
  const reassignError = disabling && total > 0 && !reassignTo ? "Choose who takes over their work." : undefined;
  const loading = disabling && !work && !workError;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (loading || workError || reasonError || reassignError) return;
    onSave(reason, total > 0 ? reassignTo : "");
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={disabling ? `Disable ${member.name}` : `Re-enable ${member.name}`}
      description={
        disabling
          ? "They lose access immediately. Nothing is deleted: their name stays on past records, and you can re-enable them later."
          : `They can sign in again as ${ROLE_LABELS[member.role]}.`
      }
      footer={<Footer onClose={onClose} form="status-form" label={disabling ? "Disable" : "Re-enable"} danger={disabling} disabled={loading} />}
    >
      <form id="status-form" onSubmit={submit} noValidate className="grid gap-4">
        {disabling && (
          <div className="rounded-xl bg-navy-50/60 px-4 py-3 text-sm text-navy-700">
            {workError ? (
              <p className="text-rose-700">{workError}</p>
            ) : !work ? (
              <p className="text-navy-400">Checking their open work…</p>
            ) : total === 0 ? (
              <p>They have no open work to hand over.</p>
            ) : (
              <>
                <p className="font-medium text-navy-900">These move to the colleague you choose:</p>
                <ul className="mt-1 list-inside list-disc text-navy-600">
                  {(Object.keys(OPEN_WORK_LABELS) as (keyof OpenWork)[])
                    .filter((k) => work[k] > 0)
                    .map((k) => (
                      <li key={k}>
                        {work[k]} {OPEN_WORK_LABELS[k][work[k] === 1 ? 0 : 1]}
                      </li>
                    ))}
                </ul>
                <p className="mt-1 text-xs text-navy-400">Won/lost leads, accepted quotations and finished bookings keep their original agent.</p>
              </>
            )}
          </div>
        )}
        {disabling && total > 0 && (
          <Field id="reassign" label="Hand over to" required error={submitted ? reassignError : undefined}>
            <Select id="reassign" value={reassignTo} onChange={setReassignTo} error={submitted ? reassignError : undefined}>
              <option value="">Choose a colleague…</option>
              {owners.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name} · {ROLE_LABELS[c.role]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <ReasonField
          id="statusReason"
          value={reason}
          onChange={setReason}
          error={submitted ? reasonError : undefined}
          placeholder={disabling ? "e.g. Left the company on 30 Nov" : "e.g. Back for the summer season"}
        />
      </form>
    </Modal>
  );
}

/* ── Team name ── */

export function TeamNameModal({ team, onClose, onSave }: { team?: TeamGroup; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [submitted, setSubmitted] = useState(false);
  const error = submitted ? validateTeamName(name) : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (validateTeamName(name)) return;
    onSave(name);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={team ? "Rename team" : "New team"}
      description="Sales managers see the customers, leads, quotations and bookings of the teams they manage."
      footer={<Footer onClose={onClose} form="team-form" label={team ? "Save" : "Create team"} />}
    >
      <form id="team-form" onSubmit={submit} noValidate>
        <Field id="teamName" label="Team name" required error={error}>
          <input {...fieldA11y("teamName", { error })} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputClass(!!error)} />
        </Field>
      </form>
    </Modal>
  );
}
