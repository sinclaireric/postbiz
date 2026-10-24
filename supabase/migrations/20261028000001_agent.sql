-- Postbiz : conversations de l'agent (page « Agent » de l'application web). Une conversation appartient à son auteur, dans une organisation :
-- un collègue de la même organisation ne la lit pas. Seuls les administrateurs et les membres en ont (comme l'assistant IA du composeur) ;
-- un lecteur n'en voit aucune. Les publications préparées par l'agent sont gardées dans le message (colonne `proposals`) avec leur état
-- (en attente, brouillon, programmée) ; leur enregistrement dans le calendrier passe par la table `posts` et ses règles habituelles.

create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Cible de la clé étrangère des messages : un message ne peut pas être rattaché à une conversation d'une autre organisation.
  unique (id, org_id)
);

create index agent_threads_owner_idx on public.agent_threads (org_id, user_id, updated_at desc);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  org_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (char_length(content) <= 20000),
  proposals jsonb not null default '[]' check (jsonb_typeof(proposals) = 'array' and pg_column_size(proposals) <= 200000),
  media_ids jsonb not null default '[]' check (jsonb_typeof(media_ids) = 'array' and jsonb_array_length(media_ids) <= 20),
  created_at timestamptz not null default now(),
  foreign key (thread_id, org_id) references public.agent_threads (id, org_id) on delete cascade
);

create index agent_messages_thread_idx on public.agent_messages (thread_id, created_at);

-- Plafonds : l'historique est relu par le modèle (facturé à l'usage) et affiché en entier.
create function public.agent_threads_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.agent_threads t where t.org_id = new.org_id and t.user_id = new.user_id) >= 200 then
    raise exception 'agent_threads_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger agent_threads_limit before insert on public.agent_threads
  for each row execute function public.agent_threads_limit();

create function public.agent_messages_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.agent_messages m where m.thread_id = new.thread_id) >= 400 then
    raise exception 'agent_messages_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger agent_messages_limit before insert on public.agent_messages
  for each row execute function public.agent_messages_limit();

-- Une conversation remonte en tête de liste dès qu'elle reçoit un message. La mise à jour passe par une fonction (le client ne peut pas écrire `updated_at`).
create function public.agent_messages_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.agent_threads set updated_at = now() where id = new.thread_id;
  return new;
end;
$$;

create trigger agent_messages_touch after insert on public.agent_messages
  for each row execute function public.agent_messages_touch();

alter table public.agent_threads enable row level security;
alter table public.agent_messages enable row level security;

revoke all on public.agent_threads from anon;
revoke all on public.agent_messages from anon;
-- Un client ne modifie que le titre d'une conversation, et que l'état des publications d'un message : jamais l'organisation, l'auteur, le texte ni les dates.
revoke update on public.agent_threads from authenticated;
grant update (title) on public.agent_threads to authenticated;
revoke update on public.agent_messages from authenticated;
grant update (proposals) on public.agent_messages to authenticated;

create policy agent_threads_select on public.agent_threads for select to authenticated
  using (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy agent_threads_insert on public.agent_threads for insert to authenticated
  with check (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy agent_threads_update on public.agent_threads for update to authenticated
  using (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]))
  with check (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy agent_threads_delete on public.agent_threads for delete to authenticated
  using (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));

create policy agent_messages_select on public.agent_messages for select to authenticated
  using (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and exists (select 1 from public.agent_threads t where t.id = agent_messages.thread_id and t.org_id = agent_messages.org_id and t.user_id = auth.uid())
  );
create policy agent_messages_insert on public.agent_messages for insert to authenticated
  with check (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and exists (select 1 from public.agent_threads t where t.id = agent_messages.thread_id and t.org_id = agent_messages.org_id and t.user_id = auth.uid())
  );
create policy agent_messages_update on public.agent_messages for update to authenticated
  using (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and exists (select 1 from public.agent_threads t where t.id = agent_messages.thread_id and t.org_id = agent_messages.org_id and t.user_id = auth.uid())
  )
  with check (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and exists (select 1 from public.agent_threads t where t.id = agent_messages.thread_id and t.org_id = agent_messages.org_id and t.user_id = auth.uid())
  );
-- Pas de policy de suppression sur les messages : ils disparaissent avec leur conversation (cascade).
