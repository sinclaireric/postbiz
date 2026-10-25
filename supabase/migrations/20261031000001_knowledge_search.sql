-- Postbiz : base de connaissance cherchable, partagée par l'agent, le composeur et l'inbox.
--  - les fiches (`knowledge_items`) gagnent un état d'indexation et un réglage « épinglée » : une fiche épinglée est toujours envoyée à l'IA (voix de la
--    marque, règles) ; les autres ne sont consultées que par recherche ;
--  - `knowledge_chunks` : les passages de chaque fiche, avec leur vecteur (pgvector, 1024 dimensions) et leur index plein texte. Aucun client n'y écrit :
--    l'écriture passe par `knowledge_replace_chunks`, qui contrôle le rôle de l'appelant et les plafonds ;
--  - `knowledge_search` : recherche hybride (sens + mots exacts) dans les passages d'une organisation, sous la RLS de l'appelant ;
--  - `ai_reply_suggestions` : les réponses que l'IA a suggérées dans l'inbox, et ce que l'utilisateur en a fait (mesure de la qualité).

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------- passages
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null references public.knowledge_items (id) on delete cascade,
  ord int not null check (ord >= 0),
  content text not null check (char_length(content) between 1 and 6000),
  -- Null : le passage n'est trouvable que par ses mots (le service d'embeddings était indisponible).
  embedding extensions.vector(1024),
  -- 'simple' : ni radical ni mots vides, la même chose pour toutes les langues ; les accents sont conservés.
  tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 2000),
  created_at timestamptz not null default now(),
  unique (item_id, ord)
);

create index knowledge_chunks_org_idx on public.knowledge_chunks (org_id);
create index knowledge_chunks_tsv_idx on public.knowledge_chunks using gin (tsv);
-- Pas d'index vectoriel : une organisation a au plus quelques milliers de passages, la recherche exacte filtrée par organisation suffit
-- (et évite les pièges d'un index approché partagé entre organisations).

alter table public.knowledge_chunks enable row level security;
revoke all on public.knowledge_chunks from anon;
revoke insert, update, delete on public.knowledge_chunks from authenticated;
create policy knowledge_chunks_select on public.knowledge_chunks for select to authenticated
  using (public.is_org_member(org_id));

-- ---------------------------------------------------------------- fiches
alter table public.knowledge_items
  add column pinned boolean not null default true,
  add column chunk_count int not null default 0 check (chunk_count >= 0),
  -- Date de la dernière indexation (null : fiche jamais indexée, ou modifiée depuis) et date à laquelle tous ses passages avaient leur vecteur.
  add column indexed_at timestamptz,
  add column embedded_at timestamptz;

-- Un membre règle aussi « épinglée » ; l'état d'indexation n'est écrit que par `knowledge_replace_chunks`.
revoke update on public.knowledge_items from authenticated;
grant update (title, content, pinned) on public.knowledge_items to authenticated;

-- Une fiche dont le titre ou le contenu change n'a plus de passages valables : ils sont supprimés, la fiche est à réindexer.
create function public.knowledge_items_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.title is distinct from old.title or new.content is distinct from old.content then
    delete from public.knowledge_chunks where item_id = old.id;
    new.chunk_count := 0;
    new.indexed_at := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

create trigger knowledge_items_changed before update on public.knowledge_items
  for each row execute function public.knowledge_items_changed();

-- ---------------------------------------------------------------- écriture des passages
-- p_chunks : [{ "content": "…", "embedding": [1024 nombres] | null, "meta": {…} }, …] dans l'ordre de la fiche.
-- Remplace tous les passages de la fiche. Au plus 40 passages par fiche et 3 000 par organisation (chaque passage est vectorisé, donc facturé).
create function public.knowledge_replace_chunks(p_item uuid, p_chunks jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid;
  v_total int;
  v_embedded int;
begin
  select org_id into v_org from public.knowledge_items where id = p_item;
  if v_org is null or auth.uid() is null or not public.has_org_role(v_org, array['admin', 'member']::public.org_role[]) then
    raise exception 'knowledge_forbidden' using errcode = '42501';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'knowledge_replace_chunks : p_chunks doit être un tableau' using errcode = '22023';
  end if;
  if jsonb_array_length(p_chunks) > 40 then
    raise exception 'knowledge_item_chunks_limit' using errcode = '23514';
  end if;
  if (select count(*) from public.knowledge_chunks where org_id = v_org and item_id <> p_item) + jsonb_array_length(p_chunks) > 3000 then
    raise exception 'knowledge_chunks_limit' using errcode = '23514';
  end if;

  delete from public.knowledge_chunks where item_id = p_item;
  insert into public.knowledge_chunks (org_id, item_id, ord, content, embedding, meta)
  select v_org, p_item, (c.ord - 1)::int, c.value ->> 'content',
         case when jsonb_typeof(c.value -> 'embedding') = 'array'
              then (array(select e::float8 from jsonb_array_elements_text(c.value -> 'embedding') as e))::extensions.vector end,
         case when jsonb_typeof(c.value -> 'meta') = 'object' then c.value -> 'meta' else '{}'::jsonb end
  from jsonb_array_elements(p_chunks) with ordinality as c(value, ord);

  select count(*), count(embedding) into v_total, v_embedded from public.knowledge_chunks where item_id = p_item;
  update public.knowledge_items
     set chunk_count = v_total, indexed_at = now(), embedded_at = case when v_total > 0 and v_embedded = v_total then now() end
   where id = p_item;
  return v_total;
end;
$$;
revoke execute on function public.knowledge_replace_chunks(uuid, jsonb) from public, anon;
grant execute on function public.knowledge_replace_chunks(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- recherche
-- Sens (distance cosinus, si p_embedding est fourni) et mots (p_terms : nombre de mots de la question présents dans le passage), fusionnés par rang
-- (RRF). `similarity` vaut 0 quand le passage n'est pas dans les meilleurs par le sens ; `term_hits` compte les mots présents. Au plus p_per_item passages
-- par fiche, et jamais ceux des fiches de p_exclude (déjà envoyées en entier à l'IA). Sous la RLS de l'appelant : une autre organisation ne rend rien.
create function public.knowledge_search(
  p_org uuid,
  p_embedding extensions.vector,
  p_terms text[],
  p_limit int default 6,
  p_per_item int default 3,
  p_exclude uuid[] default '{}'
) returns table (chunk_id uuid, item_id uuid, title text, content text, meta jsonb, similarity float8, term_hits int, score float8)
language sql stable set search_path = public, extensions as $$
  with scope as (
    select c.id, c.item_id, c.content, c.meta, c.embedding, c.tsv, i.title
    from public.knowledge_chunks c
    join public.knowledge_items i on i.id = c.item_id
    where c.org_id = p_org and not (c.item_id = any (coalesce(p_exclude, '{}'::uuid[])))
  ),
  vec as (
    select s.id, 1 - (s.embedding <=> p_embedding) as sim, row_number() over (order by s.embedding <=> p_embedding, s.id) as rnk
    from scope s
    where p_embedding is not null and s.embedding is not null
    order by s.embedding <=> p_embedding, s.id
    limit 30
  ),
  lex as (
    select s.id, (select count(*) from unnest(coalesce(p_terms, '{}'::text[])) as w(term) where s.tsv @@ plainto_tsquery('simple', w.term))::int as hits
    from scope s
  ),
  fts as (
    select l.id, row_number() over (order by l.hits desc, l.id) as rnk
    from lex l
    where l.hits > 0
    order by l.hits desc, l.id
    limit 30
  ),
  fused as (
    select coalesce(v.id, f.id) as id, v.sim,
           coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + f.rnk), 0) as score
    from vec v full join fts f on f.id = v.id
  ),
  ranked as (
    select s.id, s.item_id, s.title, s.content, s.meta, coalesce(z.sim, 0)::float8 as similarity, coalesce(l.hits, 0)::int as term_hits, z.score::float8 as score,
           row_number() over (partition by s.item_id order by z.score desc, s.id) as per_item
    from fused z
    join scope s on s.id = z.id
    left join lex l on l.id = z.id
  )
  select r.id, r.item_id, r.title, r.content, r.meta, r.similarity, r.term_hits, r.score
  from ranked r
  where r.per_item <= greatest(p_per_item, 1)
  order by r.score desc, r.id
  limit least(greatest(p_limit, 1), 20)
$$;
revoke execute on function public.knowledge_search(uuid, extensions.vector, text[], int, int, uuid[]) from public, anon;
grant execute on function public.knowledge_search(uuid, extensions.vector, text[], int, int, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------- suggestions de réponse (inbox)
-- Chaque suggestion de l'IA est gardée avec les sources consultées, pour mesurer ce que les utilisateurs en font (envoyée telle quelle ou modifiée) et
-- pour plafonner leur nombre par jour. Visible par les membres de l'organisation ; seul son auteur l'écrit, et il ne change que `outcome`.
create table public.ai_reply_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reply text not null check (char_length(reply) <= 5000),
  -- Faux : rien dans la base ne permettait de répondre ; vrai : la réponse s'appuie sur des passages.
  grounded boolean not null,
  needs_human boolean not null default false,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 12),
  model text not null check (char_length(model) <= 80),
  input_tokens int check (input_tokens is null or input_tokens >= 0),
  output_tokens int check (output_tokens is null or output_tokens >= 0),
  -- Null : la suggestion n'a pas (encore) servi. sent : envoyée telle quelle ; edited : envoyée après modification.
  outcome text check (outcome in ('sent', 'edited')),
  created_at timestamptz not null default now()
);

create index ai_reply_suggestions_org_idx on public.ai_reply_suggestions (org_id, created_at desc);

alter table public.ai_reply_suggestions enable row level security;
revoke all on public.ai_reply_suggestions from anon;
revoke update, delete on public.ai_reply_suggestions from authenticated;
grant update (outcome) on public.ai_reply_suggestions to authenticated;

create policy ai_reply_suggestions_select on public.ai_reply_suggestions for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy ai_reply_suggestions_insert on public.ai_reply_suggestions for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.org_id = ai_reply_suggestions.org_id)
  );
create policy ai_reply_suggestions_update on public.ai_reply_suggestions for update to authenticated
  using (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]))
  with check (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
