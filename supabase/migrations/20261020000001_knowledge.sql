-- Postbiz : base de connaissance de l'assistant IA. Des fiches de texte par organisation (ton de la marque, offres, produits,
-- questions fréquentes) que l'assistant lit pour rédiger des publications fidèles à l'activité.

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  content text not null check (char_length(btrim(content)) between 1 and 20000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_items_org_idx on public.knowledge_items (org_id, updated_at desc);

create trigger knowledge_items_updated_at before update on public.knowledge_items
  for each row execute function public.set_updated_at();

-- Au plus 100 fiches par organisation : tout le contenu est envoyé à l'assistant, facturé à l'usage.
create function public.knowledge_items_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.knowledge_items k where k.org_id = new.org_id) >= 100 then
    raise exception 'knowledge_items_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger knowledge_items_limit before insert on public.knowledge_items
  for each row execute function public.knowledge_items_limit();

alter table public.knowledge_items enable row level security;

revoke all on public.knowledge_items from anon;
-- Un client ne modifie que le titre et le contenu : jamais l'organisation, l'auteur ni les dates.
revoke update on public.knowledge_items from authenticated;
grant update (title, content) on public.knowledge_items to authenticated;

-- Lecture pour tous les membres (lecteurs compris) ; écriture pour les administrateurs et les membres.
create policy knowledge_select on public.knowledge_items for select to authenticated
  using (public.is_org_member(org_id));
create policy knowledge_insert on public.knowledge_items for insert to authenticated
  with check (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]) and created_by = auth.uid());
create policy knowledge_update on public.knowledge_items for update to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy knowledge_delete on public.knowledge_items for delete to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
