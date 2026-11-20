-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 11 · Passport & ID document protection
-- ════════════════════════════════════════════════════════════════════════════
-- • Numbers are encrypted with pgcrypto (AES-256) using a key stored in
--   Supabase Vault under the name 'flyvera_document_key'. The key is NEVER in
--   code, migrations or git. Production: create it once in the dashboard
--   (see docs/database/README.md → "Encryption key").
-- • API users cannot read or write the encrypted columns (see migration 10).
--   They use the functions below, which check the role and write an audit
--   entry every time a full number is revealed.

create or replace function private.document_key()
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'flyvera_document_key' limit 1;
  if k is null or char_length(k) < 32 then
    raise exception 'Document encryption key is missing: create the Vault secret "flyvera_document_key" (32+ characters).'
      using errcode = 'P0001';
  end if;
  return k;
end;
$$;

create or replace function private.normalize_document_number(raw text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  n text := upper(regexp_replace(coalesce(raw, ''), '[\s-]', '', 'g'));
begin
  if n !~ '^[A-Z0-9]{5,20}$' then
    raise exception 'Document numbers are 5–20 letters or digits.' using errcode = '22023';
  end if;
  return n;
end;
$$;

create or replace function private.encrypt_document(plain text)
returns bytea
language sql stable security definer set search_path = ''
as $$
  select extensions.pgp_sym_encrypt(plain, private.document_key(), 'cipher-algo=aes256');
$$;

create or replace function private.decrypt_document(secret bytea)
returns text
language sql stable security definer set search_path = ''
as $$
  select extensions.pgp_sym_decrypt(secret, private.document_key());
$$;

-- Only other SECURITY DEFINER functions may use the key.
revoke execute on function private.document_key(), private.encrypt_document(text), private.decrypt_document(bytea)
  from public, anon, authenticated;

-- ── Customer travel documents ───────────────────────────────────────────────

-- Create or replace a document. Returns its id.
create or replace function public.save_customer_travel_document(
  p_customer_id      uuid,
  p_document_number  text,
  p_expiry_date      date,
  p_issuing_country  text,
  p_document_type    public.travel_document_type default 'Passport',
  p_nationality      text default null,
  p_issue_date       date default null,
  p_is_primary       boolean default true,
  p_document_id      uuid default null      -- pass to replace an existing document's number/details
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  cust   record;
  n      text;
  doc_id uuid;
begin
  select c.id, c.organization_id into cust from public.customers c where c.id = p_customer_id;
  if cust.id is null or not private.can_access_documents(cust.organization_id, cust.id) then
    raise exception 'You do not have access to this customer''s travel documents.' using errcode = '42501';
  end if;
  if p_expiry_date is null or p_issuing_country is null then
    raise exception 'Expiry date and issuing country are required.' using errcode = '22023';
  end if;
  n := private.normalize_document_number(p_document_number);

  if p_is_primary then
    update public.customer_travel_documents
    set is_primary = false
    where customer_id = cust.id and document_type = p_document_type and is_primary
      and id is distinct from p_document_id;
  end if;

  if p_document_id is null then
    insert into public.customer_travel_documents (
      organization_id, customer_id, document_type, document_number_encrypted, number_last4,
      issuing_country, nationality, issue_date, expiry_date, is_primary, created_by)
    values (
      cust.organization_id, cust.id, p_document_type, private.encrypt_document(n), right(n, 4),
      p_issuing_country, p_nationality, p_issue_date, p_expiry_date, p_is_primary, auth.uid())
    returning id into doc_id;
  else
    update public.customer_travel_documents
    set document_type = p_document_type,
        document_number_encrypted = private.encrypt_document(n),
        number_last4 = right(n, 4),
        issuing_country = p_issuing_country,
        nationality = p_nationality,
        issue_date = p_issue_date,
        expiry_date = p_expiry_date,
        is_primary = p_is_primary,
        verified_by = null,
        verified_at = null
    where id = p_document_id and customer_id = cust.id
    returning id into doc_id;
    if doc_id is null then
      raise exception 'Travel document not found for this customer.' using errcode = 'P0002';
    end if;
  end if;
  return doc_id;
end;
$$;

-- Shows the full number to an authorised user and logs that it happened.
create or replace function public.reveal_customer_travel_document(p_document_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  d record;
begin
  select id, organization_id, customer_id, document_number_encrypted into d
  from public.customer_travel_documents where id = p_document_id;
  if d.id is null or not private.can_access_documents(d.organization_id, d.customer_id) then
    raise exception 'You do not have access to this travel document.' using errcode = '42501';
  end if;
  perform private.log_access(d.organization_id, 'REVEAL', 'customer_travel_documents', d.id,
                             jsonb_build_object('customer_id', d.customer_id));
  return private.decrypt_document(d.document_number_encrypted);
end;
$$;

-- ── Passenger documents (snapshot used for ticketing) ───────────────────────

create or replace function public.set_passenger_document(
  p_passenger_id     uuid,
  p_document_number  text,
  p_expiry_date      date,
  p_issuing_country  text,
  p_document_type    public.travel_document_type default 'Passport'
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p record;
  n text;
begin
  select id, organization_id, booking_id into p from public.passengers where id = p_passenger_id;
  if p.id is null or not private.can_access_passengers(p.organization_id, p.booking_id) then
    raise exception 'You do not have access to this passenger.' using errcode = '42501';
  end if;
  n := private.normalize_document_number(p_document_number);
  update public.passengers
  set document_type = p_document_type,
      document_number_encrypted = private.encrypt_document(n),
      document_last4 = right(n, 4),
      document_issuing_country = p_issuing_country,
      document_expiry_on = p_expiry_date
  where id = p.id;
end;
$$;

-- Copies a customer's saved document onto a passenger WITHOUT revealing it.
create or replace function public.copy_customer_document_to_passenger(p_passenger_id uuid, p_document_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p record;
  d record;
begin
  select id, organization_id, booking_id into p from public.passengers where id = p_passenger_id;
  select * into d from public.customer_travel_documents where id = p_document_id;
  if p.id is null or d.id is null or p.organization_id <> d.organization_id
     or not private.can_access_passengers(p.organization_id, p.booking_id)
     or not private.can_access_documents(d.organization_id, d.customer_id) then
    raise exception 'You do not have access to this passenger or document.' using errcode = '42501';
  end if;
  update public.passengers
  set document_type = d.document_type,
      document_number_encrypted = d.document_number_encrypted,
      document_last4 = d.number_last4,
      document_issuing_country = d.issuing_country,
      document_expiry_on = d.expiry_date,
      nationality = coalesce(nationality, d.nationality),
      customer_id = coalesce(customer_id, d.customer_id)
  where id = p.id;
end;
$$;

create or replace function public.reveal_passenger_document(p_passenger_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  p record;
begin
  select id, organization_id, booking_id, document_number_encrypted into p from public.passengers where id = p_passenger_id;
  if p.id is null or not private.can_access_passengers(p.organization_id, p.booking_id) then
    raise exception 'You do not have access to this passenger.' using errcode = '42501';
  end if;
  if p.document_number_encrypted is null then
    return null;
  end if;
  perform private.log_access(p.organization_id, 'REVEAL', 'passengers', p.id, jsonb_build_object('booking_id', p.booking_id));
  return private.decrypt_document(p.document_number_encrypted);
end;
$$;

-- Callable only by signed-in users (each function checks the role itself).
revoke execute on function
  public.save_customer_travel_document(uuid, text, date, text, public.travel_document_type, text, date, boolean, uuid),
  public.reveal_customer_travel_document(uuid),
  public.set_passenger_document(uuid, text, date, text, public.travel_document_type),
  public.copy_customer_document_to_passenger(uuid, uuid),
  public.reveal_passenger_document(uuid)
  from public, anon;
grant execute on function
  public.save_customer_travel_document(uuid, text, date, text, public.travel_document_type, text, date, boolean, uuid),
  public.reveal_customer_travel_document(uuid),
  public.set_passenger_document(uuid, text, date, text, public.travel_document_type),
  public.copy_customer_document_to_passenger(uuid, uuid),
  public.reveal_passenger_document(uuid)
  to authenticated;
