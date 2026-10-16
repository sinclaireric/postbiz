-- Postbiz : inbox unifiée (messages privés et commentaires de tous les réseaux).

create type public.conversation_kind as enum ('dm', 'comment_thread');
create type public.conversation_status as enum ('open', 'pending', 'snoozed', 'closed');
create type public.message_direction as enum ('in', 'out');
-- received : message entrant | queued -> sending -> sent | failed : message sortant
create type public.delivery_status as enum ('received', 'queued', 'sending', 'sent', 'failed');

-- Personne qui nous écrit (ou commente) sur un canal.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  platform_user_id text not null,
  name text,
  username text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, platform_user_id)
);
create index contacts_org_idx on public.contacts (org_id);
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  kind public.conversation_kind not null,
  external_id text not null,                  -- fil de messages ou commentaire racine chez le réseau
  target_external_id text,                    -- commentaires : publication ou média commenté
  status public.conversation_status not null default 'open',
  assignee_id uuid references auth.users (id) on delete set null,
  unread_count int not null default 0,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  last_inbound_at timestamptz,
  reply_window_expires_at timestamptz,        -- messages privés Meta : 24 h après le dernier message entrant
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, external_id)
);
create index conversations_inbox_idx on public.conversations (org_id, status, last_message_at desc);
create index conversations_assignee_idx on public.conversations (assignee_id) where assignee_id is not null;
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction public.message_direction not null,
  external_id text,                           -- null tant qu'un message sortant n'est pas parti
  body text,
  attachments jsonb not null default '[]'::jsonb,
  sent_by uuid references auth.users (id) on delete set null,   -- agent Postbiz pour les messages sortants
  delivery_status public.delivery_status not null,
  error text,
  locked_until timestamptz,
  body_tsv tsvector generated always as (to_tsvector('simple', coalesce(body, ''))) stored,
  raw jsonb,
  created_at timestamptz not null default now()
);
create unique index messages_external_uidx on public.messages (conversation_id, external_id) where external_id is not null;
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_org_search_idx on public.messages using gin (body_tsv);
create index messages_outbox_idx on public.messages (created_at) where direction = 'out' and delivery_status = 'queued';

create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) > 0),
  created_at timestamptz not null default now()
);
create index conversation_notes_idx on public.conversation_notes (conversation_id, created_at);

create table public.canned_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Événements bruts des webhooks : idempotence et rejeu. Aucun accès client.
create table public.inbox_events_raw (
  id uuid primary key default gen_random_uuid(),
  provider public.social_provider not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
create index inbox_events_raw_pending_idx on public.inbox_events_raw (received_at) where processed_at is null;

-- Utilisée par la policy d'assignation : l'assigné doit appartenir à l'organisation.
create function public.is_org_member_of(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_user);
$$;

-- ---------------------------------------------------------------- RLS
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_notes enable row level security;
alter table public.canned_replies enable row level security;
alter table public.inbox_events_raw enable row level security;

create policy contacts_select on public.contacts for select to authenticated
  using (public.is_org_member(org_id));

create policy conversations_select on public.conversations for select to authenticated
  using (public.is_org_member(org_id));
create policy conversations_update on public.conversations for update to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]))
  with check (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and (assignee_id is null or public.is_org_member_of(org_id, assignee_id))
  );

create policy messages_select on public.messages for select to authenticated
  using (public.is_org_member(org_id));
-- Un agent ne peut que mettre en file un message sortant à son nom, dans une conversation de son organisation.
create policy messages_insert on public.messages for insert to authenticated
  with check (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and direction = 'out'
    and delivery_status = 'queued'
    and external_id is null
    and sent_by = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.org_id = messages.org_id)
  );

create policy conversation_notes_select on public.conversation_notes for select to authenticated
  using (public.is_org_member(org_id));
create policy conversation_notes_insert on public.conversation_notes for insert to authenticated
  with check (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and author_id = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.org_id = conversation_notes.org_id)
  );

create policy canned_replies_select on public.canned_replies for select to authenticated
  using (public.is_org_member(org_id));
create policy canned_replies_write on public.canned_replies for all to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]) and created_by = auth.uid());

-- ---------------------------------------------------------------- privilèges
revoke all on public.inbox_events_raw from anon, authenticated;
revoke all on public.contacts, public.conversations, public.messages,
  public.conversation_notes, public.canned_replies from anon;
revoke insert, update, delete on public.contacts from authenticated;
revoke insert, update, delete on public.conversations from authenticated;
-- Un agent ne peut changer que le statut, l'assignation et le compteur de non-lus.
grant update (status, assignee_id, unread_count) on public.conversations to authenticated;
revoke update, delete on public.messages from authenticated;
revoke update, delete on public.conversation_notes from authenticated;
