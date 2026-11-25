"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import type { Invitation, TeamGroup, TeamMember, TeamPageData } from "@/types/team";
import { ROLE_LABELS, ROLES, type AppRole } from "@/config/roles";
import * as server from "@/lib/actions/team";
import { fold } from "@/lib/customer-search";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { cn, formatDate } from "@/lib/format";
import { InviteModal, RoleModal, StatusModal, TeamNameModal } from "./team-modals";

type Tab = "members" | "invitations" | "teams";
type Dialog =
  | { kind: "invite" }
  | { kind: "role"; member: TeamMember }
  | { kind: "status"; member: TeamMember }
  | { kind: "team"; team?: TeamGroup }
  | null;

const ROLE_TONE: Record<AppRole, BadgeTone> = {
  admin: "premium",
  sales_manager: "info",
  sales_agent: "info",
  ticketing_agent: "gold",
  finance_manager: "success",
  support_agent: "neutral",
};
const INVITE_TONE: Record<Invitation["status"], BadgeTone> = { Pending: "info", Expired: "warning", Accepted: "success", Revoked: "neutral" };

const smallBtn = "rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-60";

export function TeamWorkspace({ data }: { data: TeamPageData }) {
  const { me, isAdmin, members, invitations, teams } = data;
  const toast = useToast();
  const [busy, startBusy] = useTransition();
  const [tab, setTab] = useState<Tab>("members");
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  /** Runs one server action at a time and reports the result. */
  const run = (action: () => Promise<server.TeamResult>) =>
    startBusy(async () => {
      const r = await action();
      if (!r.ok) toast({ tone: "info", message: <p>{r.message}</p> });
      else if (r.warning) toast({ tone: "info", message: <p>{r.warning}</p> });
      else if (r.message) toast({ message: <p>{r.message}</p> });
    });

  const openInvites = invitations.filter((i) => i.status === "Pending" || i.status === "Expired");
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "members", label: "Members", count: members.filter((m) => m.status === "active").length },
    ...(isAdmin ? [{ id: "invitations" as const, label: "Invitations", count: openInvites.length }] : []),
    { id: "teams", label: "Teams", count: teams.length },
  ];

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-navy-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Team sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  tab === t.id ? "bg-navy-900 text-white" : "text-navy-500 hover:bg-navy-50 hover:text-navy-900",
                )}
              >
                {t.label}
                <span className={cn("rounded-full px-1.5 text-xs", tab === t.id ? "bg-white/20" : "bg-navy-50 text-navy-500")}>{t.count}</span>
              </button>
            ))}
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              {tab === "teams" ? (
                <button onClick={() => setDialog({ kind: "team" })} className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
                  <Icon name="plus" size={16} /> New team
                </button>
              ) : (
                <button onClick={() => setDialog({ kind: "invite" })} className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
                  <Icon name="plus" size={16} /> Invite person
                </button>
              )}
            </div>
          )}
        </div>

        {tab === "members" && <MembersTab members={members} me={me} isAdmin={isAdmin} busy={busy} onDialog={setDialog} />}
        {tab === "invitations" && isAdmin && (
          <InvitationsTab
            invitations={invitations}
            busy={busy}
            onResend={(i) => run(() => server.resendInvitation(i.id))}
            onRevoke={(i) => {
              if (window.confirm(`Revoke the invitation for ${i.email}? Their email link will stop working.`)) run(() => server.revokeInvitation(i.id));
            }}
          />
        )}
        {tab === "teams" && <TeamsTab teams={teams} members={members} isAdmin={isAdmin} busy={busy} run={run} onRename={(team) => setDialog({ kind: "team", team })} />}
      </Card>

      {dialog?.kind === "invite" && (
        <InviteModal
          teams={teams}
          onClose={close}
          onSave={(v) => {
            close();
            run(() => server.inviteMember(v));
          }}
        />
      )}
      {dialog?.kind === "role" && (
        <RoleModal
          member={dialog.member}
          onClose={close}
          onSave={(role, reason) => {
            close();
            run(() => server.changeMemberRole(dialog.member.userId, role, reason));
          }}
        />
      )}
      {dialog?.kind === "status" && (
        <StatusModal
          member={dialog.member}
          colleagues={members}
          onClose={close}
          onSave={(reason, reassignTo) => {
            close();
            const next = dialog.member.status === "active" ? "disabled" : "active";
            run(() => server.setMemberStatus(dialog.member.userId, next, reason, reassignTo || null));
          }}
        />
      )}
      {dialog?.kind === "team" && (
        <TeamNameModal
          team={dialog.team}
          onClose={close}
          onSave={(name) => {
            close();
            run(() => server.saveTeam(dialog.team?.id ?? null, name));
          }}
        />
      )}
    </div>
  );
}

/* ─────────────── Members ─────────────── */

function MembersTab({
  members,
  me,
  isAdmin,
  busy,
  onDialog,
}: {
  members: TeamMember[];
  me: string;
  isAdmin: boolean;
  busy: boolean;
  onDialog: (d: Dialog) => void;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<AppRole | "">("");
  const [status, setStatus] = useState<"active" | "disabled" | "">("active");
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return members.filter(
      (m) =>
        (!role || m.role === role) &&
        (!status || m.status === status) &&
        (!q || q.split(/\s+/).every((w) => fold([m.name, m.email ?? "", ROLE_LABELS[m.role], ...m.teams.map((t) => t.name)].join(" ")).includes(w))),
    );
  }, [members, query, role, status]);

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-navy-50 px-4 py-3 sm:flex-row sm:px-5">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search the team</span>
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAdmin ? "Name, email, role, team…" : "Name, role, team…"}
            className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
          />
        </label>
        <select value={role} onChange={(e) => setRole(e.target.value as AppRole | "")} aria-label="Role" className="h-10 rounded-xl border border-navy-100 bg-white px-3 text-sm text-navy-700">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status" className="h-10 rounded-xl border border-navy-100 bg-white px-3 text-sm text-navy-700">
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="">Everyone</option>
          </select>
        )}
      </div>

      {visible.length === 0 ? (
        <Empty title="Nobody matches" text="Try another search or filter." />
      ) : (
        <ul className="divide-y divide-navy-50">
          {visible.map((m) => {
            const self = m.userId === me;
            const expanded = open === m.userId;
            return (
              <li key={m.userId} className={cn("px-4 py-3 sm:px-6", m.status === "disabled" && "bg-navy-50/40")}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold", m.status === "active" ? "bg-sky-brand-light text-sky-brand-dark" : "bg-navy-100 text-navy-400")}>
                      {initials(m.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-navy-900">
                        <span className="truncate">{m.name}</span>
                        {self && <span className="text-xs font-normal text-navy-400">(you)</span>}
                        <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABELS[m.role]}</Badge>
                        {m.status === "disabled" && <Badge tone="danger">Disabled</Badge>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-navy-500">
                        {m.email && <>{m.email} · </>}
                        {m.teams.length ? m.teams.map((t) => (t.isManager ? `${t.name} (manager)` : t.name)).join(", ") : "No team"}
                        {isAdmin && (
                          <>
                            {" "}
                            · {m.lastSignInAt ? `last signed in ${formatDate(m.lastSignInAt.slice(0, 10))}` : "hasn't signed in yet"}
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {!self && m.status === "active" && (
                        <button disabled={busy} onClick={() => onDialog({ kind: "role", member: m })} className={`${smallBtn} border border-navy-100 text-navy-700 hover:bg-navy-50`}>
                          Change role
                        </button>
                      )}
                      {!self && (
                        <button
                          disabled={busy}
                          onClick={() => onDialog({ kind: "status", member: m })}
                          className={cn(smallBtn, m.status === "active" ? "border border-rose-200 text-rose-700 hover:bg-rose-50" : "bg-emerald-600 text-white hover:bg-emerald-700")}
                        >
                          {m.status === "active" ? "Disable" : "Re-enable"}
                        </button>
                      )}
                      <button
                        onClick={() => setOpen(expanded ? null : m.userId)}
                        aria-expanded={expanded}
                        className={`${smallBtn} text-navy-500 hover:bg-navy-50 hover:text-navy-900`}
                      >
                        History
                      </button>
                    </div>
                  )}
                </div>
                {expanded && (
                  <ol className="ml-12 mt-3 space-y-2 border-l border-navy-100 pl-4">
                    {(m.history ?? []).length === 0 ? (
                      <li className="text-xs text-navy-400">No access changes recorded. Joined {formatDate(m.joinedOn)}.</li>
                    ) : (
                      m.history!.map((e, i) => (
                        <li key={i} className="text-xs">
                          <p className="text-navy-700">
                            <span className="font-medium">{e.text}</span>
                            {e.reason && <> — “{e.reason}”</>}
                          </p>
                          <p className="text-navy-400">
                            {formatDate(e.at.slice(0, 10))} · by {e.by}
                          </p>
                        </li>
                      ))
                    )}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!isAdmin && <p className="border-t border-navy-50 px-5 py-3 text-xs text-navy-400 sm:px-6">Only an admin can invite people or change roles.</p>}
    </>
  );
}

/* ─────────────── Invitations ─────────────── */

function InvitationsTab({
  invitations,
  busy,
  onResend,
  onRevoke,
}: {
  invitations: Invitation[];
  busy: boolean;
  onResend: (i: Invitation) => void;
  onRevoke: (i: Invitation) => void;
}) {
  if (!invitations.length) return <Empty title="No invitations yet" text="Invite people with the button above." />;
  return (
    <ul className="divide-y divide-navy-50">
      {invitations.map((i) => {
        const open = i.status === "Pending" || i.status === "Expired";
        return (
          <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium text-navy-900">
                {i.fullName || i.email}
                <Badge tone={ROLE_TONE[i.role]}>{ROLE_LABELS[i.role]}</Badge>
                <Badge tone={INVITE_TONE[i.status]}>{i.status}</Badge>
              </p>
              <p className="mt-0.5 text-xs text-navy-500">
                {i.email}
                {i.teamName && <> · {i.teamName}</>} · invited by {i.invitedBy} on {formatDate(i.createdOn)}
                {open && (
                  <>
                    {" "}
                    · {i.sendCount ? `email sent ${i.sendCount}×${i.lastSentAt ? `, last ${formatDate(i.lastSentAt.slice(0, 10))}` : ""}` : "email not sent yet"}
                    {i.status === "Pending" && <> · expires {formatDate(i.expiresAt.slice(0, 10))}</>}
                  </>
                )}
              </p>
            </div>
            {open && (
              <div className="flex shrink-0 gap-1.5">
                <button disabled={busy} onClick={() => onResend(i)} className={`${smallBtn} bg-navy-900 text-white hover:bg-navy-800`}>
                  {i.sendCount ? "Resend" : "Send"}
                </button>
                <button disabled={busy} onClick={() => onRevoke(i)} className={`${smallBtn} border border-rose-200 text-rose-700 hover:bg-rose-50`}>
                  Revoke
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ─────────────── Teams ─────────────── */

function TeamsTab({
  teams,
  members,
  isAdmin,
  busy,
  run,
  onRename,
}: {
  teams: TeamGroup[];
  members: TeamMember[];
  isAdmin: boolean;
  busy: boolean;
  run: (action: () => Promise<server.TeamResult>) => void;
  onRename: (team: TeamGroup) => void;
}) {
  if (!teams.length) {
    return <Empty title="No teams yet" text={isAdmin ? "Create a team, add sales agents and choose who manages it." : "Your admin hasn't set up teams."} />;
  }
  const active = members.filter((m) => m.status === "active");
  return (
    <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
      {teams.map((t) => {
        const addable = active.filter((m) => !t.members.some((x) => x.userId === m.userId));
        return (
          <section key={t.id} className="rounded-xl border border-navy-100">
            <header className="flex items-center justify-between gap-2 border-b border-navy-50 px-4 py-3">
              <h3 className="font-semibold text-navy-900">{t.name}</h3>
              {isAdmin && (
                <div className="flex gap-1">
                  <button disabled={busy} onClick={() => onRename(t)} className={`${smallBtn} text-navy-500 hover:bg-navy-50`}>
                    Rename
                  </button>
                  {t.members.length === 0 && (
                    <button
                      disabled={busy}
                      onClick={() => window.confirm(`Delete ${t.name}?`) && run(() => server.deleteTeam(t.id))}
                      className={`${smallBtn} text-rose-600 hover:bg-rose-50`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </header>
            {t.members.length === 0 ? (
              <p className="px-4 py-4 text-sm text-navy-400">Nobody in this team yet.</p>
            ) : (
              <ul className="divide-y divide-navy-50">
                {t.members.map((x) => (
                  <li key={x.userId} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="flex items-center gap-2 text-navy-800">
                      {x.name}
                      {x.isManager && <Badge tone="gold">Manager</Badge>}
                    </span>
                    {isAdmin && (
                      <span className="flex gap-1">
                        <button
                          disabled={busy}
                          onClick={() => run(() => server.setTeamMember(t.id, x.userId, true, !x.isManager))}
                          className={`${smallBtn} text-navy-500 hover:bg-navy-50`}
                        >
                          {x.isManager ? "Not manager" : "Make manager"}
                        </button>
                        <button disabled={busy} onClick={() => run(() => server.setTeamMember(t.id, x.userId, false, false))} className={`${smallBtn} text-rose-600 hover:bg-rose-50`}>
                          Remove
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isAdmin && addable.length > 0 && (
              <div className="border-t border-navy-50 px-4 py-3">
                <label className="sr-only" htmlFor={`add-${t.id}`}>
                  Add to {t.name}
                </label>
                <select
                  id={`add-${t.id}`}
                  value=""
                  disabled={busy}
                  onChange={(e) => e.target.value && run(() => server.setTeamMember(t.id, e.target.value, true, false))}
                  className="h-9 w-full rounded-lg border border-navy-100 bg-white px-2 text-sm text-navy-700"
                >
                  <option value="">Add someone…</option>
                  {addable.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name} · {ROLE_LABELS[m.role]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>
        );
      })}
      <p className="text-xs text-navy-400 lg:col-span-2">
        A team&apos;s managers (with the Sales Manager role) see the customers, leads, quotations and bookings of everyone in it.
      </p>
    </div>
  );
}

/* ─────────────── Bits ─────────────── */

function Empty({ title, text }: { title: string; text: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <Icon name="team" size={28} className="text-navy-300" />
      <p className="mt-3 font-semibold text-navy-900">{title}</p>
      <p className="mt-1 text-sm text-navy-400">{text}</p>
    </div>
  );
}

function initials(name: string) {
  const base = name.includes("@") ? name.split("@")[0] : name;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : base.slice(0, 2)).toUpperCase();
}
