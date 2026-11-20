-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 08 · WhatsApp conversations & messages, AI actions
-- ════════════════════════════════════════════════════════════════════════════
-- Inbound WhatsApp messages and delivery receipts arrive through a server-side
-- webhook using the service role (never the browser).

create table public.whatsapp_conversations (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  contact_phone           text not null check (regexp_replace(contact_phone, '[\s().-]', '', 'g') ~ '^\+[0-9]{7,15}$'),
  contact_phone_e164      text generated always as (regexp_replace(contact_phone, '[\s().-]', '', 'g')) stored,
  contact_name            text check (char_length(contact_name) <= 80),
  customer_id             uuid,
  lead_id                 uuid,
  assigned_to             uuid,
  status                  public.wa_conversation_status not null default 'Open',
  unread_count            integer not null default 0 check (unread_count >= 0),
  last_message_at         timestamptz,
  service_window_ends_at  timestamptz,   -- WhatsApp allows free-form replies for 24h after the customer's last message
  opted_in                boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (organization_id, contact_phone_e164),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete set null (lead_id),
  foreign key (organization_id, assigned_to)
    references public.organization_members (organization_id, user_id) on delete set null (assigned_to)
);
create index whatsapp_conversations_recent_idx on public.whatsapp_conversations (organization_id, last_message_at desc);

create table public.whatsapp_messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  conversation_id     uuid not null,
  direction           public.wa_direction not null,
  message_type        public.wa_message_type not null default 'Text',
  body                text check (char_length(body) <= 4096),
  media_storage_path  text,
  template_name       text,
  wa_message_id       text unique,                  -- id from the WhatsApp Cloud API
  status              public.wa_message_status not null,
  error               text,
  sent_by             uuid references public.profiles (id) on delete set null,
  sent_at             timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  check (message_type <> 'Template' or template_name is not null),
  check (direction = 'Outbound' or status = 'Received'),
  foreign key (conversation_id, organization_id) references public.whatsapp_conversations (id, organization_id) on delete cascade
);
create index whatsapp_messages_conversation_idx on public.whatsapp_messages (conversation_id, sent_at);

-- AI actions: every request is logged; nothing is applied without a human ----
create table public.ai_actions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  requested_by     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  action_kind      public.ai_action_kind not null,
  status           public.ai_action_status not null default 'Proposed',
  model            text,
  input            jsonb not null default '{}'::jsonb,
  output           jsonb,
  lead_id          uuid,
  customer_id      uuid,
  quotation_id     uuid,
  booking_id       uuid,
  conversation_id  uuid,
  input_tokens     integer check (input_tokens >= 0),
  output_tokens    integer check (output_tokens >= 0),
  cost_usd         numeric(10, 4) check (cost_usd >= 0),
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  applied_at       timestamptz,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status not in ('Approved', 'Applied', 'Rejected') or reviewed_by is not null),
  check ((status = 'Applied') = (applied_at is not null)),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete set null (lead_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id) on delete set null (quotation_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete set null (booking_id),
  foreign key (conversation_id, organization_id) references public.whatsapp_conversations (id, organization_id) on delete set null (conversation_id)
);
create index ai_actions_requester_idx on public.ai_actions (organization_id, requested_by, created_at desc);

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.ai_actions enable row level security;

create trigger whatsapp_conversations_updated_at before update on public.whatsapp_conversations for each row execute function private.set_updated_at();
create trigger ai_actions_updated_at before update on public.ai_actions for each row execute function private.set_updated_at();
