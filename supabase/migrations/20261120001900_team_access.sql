-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 19 · Team & access: invitations, roles, disabling, reassignment
-- ════════════════════════════════════════════════════════════════════════════
--   1. Invitations carry the person's name and team, can be revoked, and record
--      each time the email was sent. A revoked or expired invitation never grants access.
--   2. Access is granted when the invited person CONFIRMS their email (accepts the
--      invitation) — not when Supabase creates their login on sending the email.
--      Logins created already confirmed (e.g. in the dashboard) are granted at once.
--   3. Admins change roles and disable / re-enable people through functions that
--      require a reason (written to the audit log). Admins can't change their own
--      role or disable themselves; the agency always keeps an active admin.
--   4. Disabling someone with open work requires a colleague to take it over:
--      their customers, open leads, draft/sent quotations, active bookings, open
--      tasks and open WhatsApp conversations move in the same step (audited).
--   5. Members and invitations can no longer be written directly by app users.
-- People are never deleted: disabled members keep their name on past records.

-- ── 1. Invitations ──────────────────────────────────────────────────────────
alter table public.organization_invitations
  add column full_name    text check (full_name is null or char_length(btrim(full_name)) between 2 and 120),
  add column team_id      uuid,
  add column revoked_at   timestamptz,
  add column revoked_by   uuid references public.profiles (id) on delete set null,
  add column last_sent_at timestamptz,
  add column send_count   integer not null default 0 check (send_count >= 0),
  add constraint organization_invitations_team_fkey foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete set null (team_id),
  add constraint organization_invitations_not_both check (accepted_at is null or revoked_at is null);

-- A revoked invitation no longer blocks a new one for the same address.
drop index public.organization_invitations_pending_uidx;
create unique index organization_invitations_pending_uidx
  on public.organization_invitations (organization_id, email) where accepted_at is null and revoked_at is null;

-- ── 2. Granting access ──────────────────────────────────────────────────────
-- Grants every valid invitation for this login: membership with the invited role, the team, accepted.
create or replace function private.accept_invitations(p_user_id uuid, p_email text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  inv     record;
  granted integer := 0;
begin
  for inv in
    select * from public.organization_invitations i
    where i.email = lower(p_email) and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    for update
  loop
    insert into public.organization_members (organization_id, user_id, role)
    values (inv.organization_id, p_user_id, inv.role)
    on conflict do nothing;
    if inv.team_id is not null then
      insert into public.team_members (team_id, organization_id, user_id)
      values (inv.team_id, inv.organization_id, p_user_id)
      on conflict do nothing;
    end if;
    update public.organization_invitations set accepted_at = now() where id = inv.id;
    granted := granted + 1;
  end loop;
  return granted;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      (select i.full_name from public.organization_invitations i
       where i.email = lower(new.email) and i.accepted_at is null and i.revoked_at is null and i.full_name is not null
       order by i.created_at desc limit 1),
      ''),
    new.raw_user_meta_data ->> 'display_name'
  )
  on conflict (id) do nothing;

  -- Access only once the email is confirmed (an invited login isn't confirmed until accepted).
  if new.email_confirmed_at is not null then
    perform private.accept_invitations(new.id, new.email);
  end if;
  return new;
end;
$$;

create or replace function private.handle_user_confirmed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform private.accept_invitations(new.id, new.email);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function private.handle_user_confirmed();

-- ── 3. Inviting ─────────────────────────────────────────────────────────────
-- Returns { id, granted }: granted = the address already had a confirmed login, so access was given now
-- (no email needed). Otherwise the app sends the invitation email and calls mark_invitation_sent().
create or replace function public.invite_member(
  p_organization_id uuid,
  p_email           text,
  p_full_name       text,
  p_role            public.app_role,
  p_team_id         uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_member record;
  v_login  record;
  v_id     uuid;
begin
  if not private.has_role(p_organization_id, 'admin') then
    raise exception 'Only an admin can invite people.' using errcode = '42501';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Enter their full name (2–120 characters).' using errcode = '22023';
  end if;
  if p_role is null then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams t where t.id = p_team_id and t.organization_id = p_organization_id) then
    raise exception 'That team doesn''t exist.' using errcode = 'P0001';
  end if;

  select m.status into v_member
  from public.organization_members m join auth.users u on u.id = m.user_id
  where m.organization_id = p_organization_id and lower(u.email) = v_email;
  if found then
    if v_member.status = 'disabled' then
      raise exception '% is already in the team but disabled — re-enable them instead.', v_email using errcode = 'P0001';
    end if;
    raise exception '% is already in the team.', v_email using errcode = 'P0001';
  end if;

  if exists (select 1 from public.organization_invitations i
             where i.organization_id = p_organization_id and i.email = v_email
               and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) then
    raise exception '% has already been invited — resend the invitation instead.', v_email using errcode = 'P0001';
  end if;
  -- An expired invitation is closed so a new one can take its place.
  update public.organization_invitations
  set revoked_at = now(), revoked_by = auth.uid()
  where organization_id = p_organization_id and email = v_email and accepted_at is null and revoked_at is null;

  insert into public.organization_invitations (organization_id, email, full_name, role, team_id, invited_by)
  values (p_organization_id, v_email, v_name, p_role, p_team_id, auth.uid())
  returning id into v_id;

  -- Someone who already has a confirmed login gets access now.
  select id, email_confirmed_at into v_login from auth.users where lower(email) = v_email;
  if v_login.id is not null and v_login.email_confirmed_at is not null then
    perform private.accept_invitations(v_login.id, v_email);
    return jsonb_build_object('id', v_id, 'granted', true);
  end if;
  return jsonb_build_object('id', v_id, 'granted', false);
end;
$$;

create or replace function public.mark_invitation_sent(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  inv record;
begin
  select * into inv from public.organization_invitations where id = p_invitation_id;
  if inv.id is null or not private.has_role(inv.organization_id, 'admin') then
    raise exception 'Only an admin can send invitations.' using errcode = '42501';
  end if;
  if inv.accepted_at is not null or inv.revoked_at is not null then
    raise exception 'This invitation is no longer open.' using errcode = 'P0001';
  end if;
  update public.organization_invitations
  set last_sent_at = now(), send_count = send_count + 1, expires_at = greatest(expires_at, now() + interval '14 days')
  where id = inv.id;
end;
$$;

-- Returns the id of the invited person's login when they never confirmed it, so the app can remove it
-- (their invitation link stops working). Confirmed logins are never returned.
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  inv     record;
  v_login uuid;
begin
  select * into inv from public.organization_invitations where id = p_invitation_id;
  if inv.id is null or not private.has_role(inv.organization_id, 'admin') then
    raise exception 'Only an admin can revoke invitations.' using errcode = '42501';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invitation was already accepted — disable the person instead.' using errcode = 'P0001';
  end if;
  if inv.revoked_at is not null then
    raise exception 'This invitation was already revoked.' using errcode = 'P0001';
  end if;
  update public.organization_invitations set revoked_at = now(), revoked_by = auth.uid() where id = inv.id;

  select u.id into v_login from auth.users u
  where lower(u.email) = inv.email and u.email_confirmed_at is null
    and not exists (select 1 from public.organization_members m where m.user_id = u.id);
  return v_login;
end;
$$;

-- ── 4. Roles and status ─────────────────────────────────────────────────────
create or replace function public.change_member_role(p_organization_id uuid, p_user_id uuid, p_role public.app_role, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m        record;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.has_role(p_organization_id, 'admin') then
    raise exception 'Only an admin can change roles.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own role. Ask another admin.' using errcode = '42501';
  end if;
  select * into m from public.organization_members where organization_id = p_organization_id and user_id = p_user_id;
  if m.user_id is null then
    raise exception 'That person isn''t in this agency.' using errcode = 'P0001';
  end if;
  if p_role is null or p_role = m.role then
    raise exception 'Choose a different role.' using errcode = '22023';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 200 then
    raise exception 'Give a reason (5–200 characters).' using errcode = '22023';
  end if;

  perform set_config('flyvera.change_reason', v_reason, true);
  update public.organization_members set role = p_role where organization_id = p_organization_id and user_id = p_user_id;
  perform set_config('flyvera.change_reason', '', true);
end;
$$;

-- Open work that moves when someone is disabled.
create or replace function private.open_work(p_organization_id uuid, p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'customers',     (select count(*) from public.customers where organization_id = p_organization_id and assigned_to = p_user_id),
    'leads',         (select count(*) from public.leads where organization_id = p_organization_id and assigned_to = p_user_id
                        and stage not in ('Won', 'Lost')),
    'quotations',    (select count(*) from public.quotations where organization_id = p_organization_id and prepared_by = p_user_id
                        and status in ('Draft', 'Sent')),
    'bookings',      (select count(*) from public.bookings where organization_id = p_organization_id and agent_id = p_user_id
                        and status not in ('Completed', 'Cancelled')),
    'tasks',         (select count(*) from public.tasks where organization_id = p_organization_id and assigned_to = p_user_id
                        and status = 'Open'),
    'conversations', (select count(*) from public.whatsapp_conversations where organization_id = p_organization_id
                        and assigned_to = p_user_id and status <> 'Closed')
  );
$$;

-- Admins: what would move if this person were disabled (shown before confirming).
create or replace function public.member_open_work(p_organization_id uuid, p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_role(p_organization_id, 'admin') then
    raise exception 'Only an admin can see this.' using errcode = '42501';
  end if;
  return private.open_work(p_organization_id, p_user_id);
end;
$$;

-- Returns what was moved, e.g. {"customers": 4, "leads": 2, …}.
create or replace function public.set_member_status(
  p_organization_id uuid,
  p_user_id         uuid,
  p_status          public.member_status,
  p_reason          text,
  p_reassign_to     uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m        record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_work   jsonb;
  v_total  bigint;
  v_to     record;
begin
  if not private.has_role(p_organization_id, 'admin') then
    raise exception 'Only an admin can enable or disable people.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t disable or re-enable yourself. Ask another admin.' using errcode = '42501';
  end if;
  select * into m from public.organization_members where organization_id = p_organization_id and user_id = p_user_id;
  if m.user_id is null then
    raise exception 'That person isn''t in this agency.' using errcode = 'P0001';
  end if;
  if p_status is null or p_status = m.status then
    raise exception 'They are already %.', m.status using errcode = '22023';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 200 then
    raise exception 'Give a reason (5–200 characters).' using errcode = '22023';
  end if;

  v_work := jsonb_build_object();
  if p_status = 'disabled' then
    v_work := private.open_work(p_organization_id, p_user_id);
    select sum(value::bigint) into v_total from jsonb_each_text(v_work);
    if v_total > 0 then
      if p_reassign_to is null then
        raise exception 'They still have open work — choose a colleague to take it over.' using errcode = 'P0001';
      end if;
      select * into v_to from public.organization_members where organization_id = p_organization_id and user_id = p_reassign_to;
      if v_to.user_id is null or v_to.status <> 'active' or p_reassign_to = p_user_id
         or v_to.role not in ('admin', 'sales_manager', 'sales_agent') then
        raise exception 'Choose an active admin or sales colleague to take over their work.' using errcode = 'P0001';
      end if;

      perform set_config('flyvera.change_reason', 'Reassigned on disabling a team member: ' || v_reason, true);
      update public.customers set assigned_to = p_reassign_to where organization_id = p_organization_id and assigned_to = p_user_id;
      update public.leads set assigned_to = p_reassign_to
        where organization_id = p_organization_id and assigned_to = p_user_id and stage not in ('Won', 'Lost');
      update public.quotations set prepared_by = p_reassign_to
        where organization_id = p_organization_id and prepared_by = p_user_id and status in ('Draft', 'Sent');
      update public.bookings set agent_id = p_reassign_to
        where organization_id = p_organization_id and agent_id = p_user_id and status not in ('Completed', 'Cancelled');
      update public.tasks set assigned_to = p_reassign_to
        where organization_id = p_organization_id and assigned_to = p_user_id and status = 'Open';
      update public.whatsapp_conversations set assigned_to = p_reassign_to
        where organization_id = p_organization_id and assigned_to = p_user_id and status <> 'Closed';
    else
      v_work := jsonb_build_object();
    end if;
  end if;

  perform set_config('flyvera.change_reason', v_reason, true);
  update public.organization_members set status = p_status where organization_id = p_organization_id and user_id = p_user_id;
  perform set_config('flyvera.change_reason', '', true);
  return v_work;
end;
$$;

-- ── 5. Directory (admins): email and last sign-in live in the login system ──
create or replace function public.team_directory(p_organization_id uuid)
returns table (
  user_id         uuid,
  full_name       text,
  email           text,
  role            public.app_role,
  status          public.member_status,
  joined_at       timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_role(p_organization_id, 'admin') then
    raise exception 'Only an admin can see the team directory.' using errcode = '42501';
  end if;
  return query
    select m.user_id, coalesce(nullif(btrim(p.display_name), ''), p.full_name), u.email::text, m.role, m.status, m.created_at, u.last_sign_in_at
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
    order by m.status, p.full_name;
end;
$$;

-- ── 6. Every change goes through the functions ──────────────────────────────
revoke insert, update, delete on public.organization_members from authenticated;
revoke insert, update, delete on public.organization_invitations from authenticated;

revoke execute on function
  public.invite_member(uuid, text, text, public.app_role, uuid),
  public.mark_invitation_sent(uuid),
  public.revoke_invitation(uuid),
  public.change_member_role(uuid, uuid, public.app_role, text),
  public.member_open_work(uuid, uuid),
  public.set_member_status(uuid, uuid, public.member_status, text, uuid),
  public.team_directory(uuid)
  from public, anon;
grant execute on function
  public.invite_member(uuid, text, text, public.app_role, uuid),
  public.mark_invitation_sent(uuid),
  public.revoke_invitation(uuid),
  public.change_member_role(uuid, uuid, public.app_role, text),
  public.member_open_work(uuid, uuid),
  public.set_member_status(uuid, uuid, public.member_status, text, uuid),
  public.team_directory(uuid)
  to authenticated;
revoke execute on function
  private.accept_invitations(uuid, text),
  private.handle_user_confirmed(),
  private.open_work(uuid, uuid)
  from public, anon, authenticated;
