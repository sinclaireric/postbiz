-- Postbiz : la base de connaissance lit aussi des documents (PDF, Word, texte, CSV, HTML) et des sites web, en plus des fiches de texte.
--  - une source (`knowledge_items`) a un type (`kind` : text, file, website), un état de lecture (`status`) et, pour les deux nouveaux types, tout ce qu'il faut pour la lire
--    et la relire : adresse ou fichier, réglages, chiffres de la dernière lecture, prochaine échéance ;
--  - le navigateur dépose un fichier dans le bucket privé `knowledge`, puis `knowledge_add_file` l'enregistre ; `knowledge_add_website` enregistre un site. Aucun client
--    n'écrit directement ces lignes : les fonctions contrôlent le rôle, la provenance du fichier, les plafonds et le nombre d'ajouts par jour ;
--  - le worker (service_role) réclame les sources à lire (`claim_knowledge_sources`), écrit les passages (`knowledge_source_write`), puis clôt la lecture
--    (`knowledge_source_complete` ou `knowledge_source_fail`) ; un site est relu toutes les semaines.

-- ---------------------------------------------------------------- sources
alter table public.knowledge_items
  add column kind text not null default 'text' check (kind in ('text', 'file', 'website')),
  add column status text not null default 'ready' check (status in ('pending', 'processing', 'ready', 'failed')),
  -- Site : adresse de départ. Fichier : chemin dans le bucket « knowledge », toujours « <organisation>/<fichier> ».
  add column url text check (url is null or (char_length(url) <= 2000 and url ~* '^https?://[^/?#@\s]+' and url !~* '^https?://[^/?#]*@')),
  add column file_path text check (file_path is null or (char_length(file_path) <= 600 and file_path !~ '(^|/)\.\.(/|$)')),
  add column mime_type text check (mime_type is null or char_length(mime_type) <= 120),
  add column size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  -- Pourquoi la dernière lecture a échoué : un code (voir SOURCE_ERRORS dans @postbiz/kb), jamais un message d'erreur.
  add column error text check (error is null or error ~ '^[a-z_]{1,40}$'),
  -- Chiffres de la dernière lecture (pages lues, passages, drapeaux) ; réglages du site (étendue, relecture hebdomadaire).
  add column stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object' and pg_column_size(stats) <= 4000),
  add column config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 2000),
  add column synced_at timestamptz,
  -- Prochaine lecture : « pending » à partir de cette date, ou « ready » à relire à cette date (sites).
  add column run_at timestamptz,
  add column attempts int not null default 0 check (attempts >= 0),
  add column locked_until timestamptz,
  add column requested_at timestamptz;

-- Pour un fichier ou un site, `content` n'est qu'un aperçu (jamais envoyé à l'IA en entier) : il peut être vide avant la première lecture.
alter table public.knowledge_items drop constraint if exists knowledge_items_content_check;
alter table public.knowledge_items
  add constraint knowledge_items_content_check check (char_length(content) <= 20000 and (kind <> 'text' or char_length(btrim(content)) >= 1)),
  add constraint knowledge_items_kind_fields check (
    (kind = 'text' and url is null and file_path is null)
    or (kind = 'file' and file_path is not null and url is null)
    or (kind = 'website' and url is not null and file_path is null)
  ),
  -- Seules les fiches de texte sont « épinglées » (envoyées en entier) ; un document ou un site se consulte par la recherche.
  add constraint knowledge_items_pinned_text check (kind = 'text' or not pinned),
  add constraint knowledge_items_text_ready check (kind <> 'text' or status = 'ready'),
  -- Un fichier se trouve dans le dossier de son organisation : le worker lit le bucket avec tous les droits, il ne doit jamais lire celui d'une autre.
  add constraint knowledge_items_file_in_org check (file_path is null or file_path like (org_id::text || '/%'));

create index knowledge_items_queue_idx on public.knowledge_items (run_at)
  where kind <> 'text' and (status in ('pending', 'processing') or run_at is not null);

-- Un client n'écrit que des fiches de texte, et ne règle que leur titre, leur contenu et leur épinglage : jamais l'état de lecture.
revoke insert on public.knowledge_items from authenticated;
grant insert (org_id, title, content, created_by, pinned) on public.knowledge_items to authenticated;
drop policy knowledge_insert on public.knowledge_items;
create policy knowledge_insert on public.knowledge_items for insert to authenticated
  with check (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[]) and created_by = auth.uid()
    and kind = 'text' and status = 'ready' and url is null and file_path is null
  );

-- Une fiche de texte dont le titre ou le contenu change n'a plus de passages valables. Pour un fichier ou un site, le contenu n'est qu'un aperçu que le worker réécrit :
-- ses passages ne sont jamais effacés par un changement de titre ou d'aperçu.
create or replace function public.knowledge_items_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'text' and (new.title is distinct from old.title or new.content is distinct from old.content) then
    delete from public.knowledge_chunks where item_id = old.id;
    new.chunk_count := 0;
    new.indexed_at := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

-- `updated_at` : pour un fichier ou un site, ni l'état de lecture ni la prolongation du verrou ne comptent comme une modification (la liste ne doit pas sauter pendant une lecture).
create function public.knowledge_items_touch() returns trigger language plpgsql as $$
begin
  if new.kind = 'text' or new.title is distinct from old.title or new.content is distinct from old.content or new.synced_at is distinct from old.synced_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger knowledge_items_updated_at on public.knowledge_items;
create trigger knowledge_items_updated_at before update on public.knowledge_items
  for each row execute function public.knowledge_items_touch();

-- Les repères d'un passage d'une page web (adresse, titre, empreinte) tiennent dans un peu plus de 2 000 octets.
alter table public.knowledge_chunks drop constraint if exists knowledge_chunks_meta_check;
alter table public.knowledge_chunks add constraint knowledge_chunks_meta_check check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 4000);

-- Les fiches de texte seules passent par `knowledge_replace_chunks` (les autres sources sont écrites par le worker).
create or replace function public.knowledge_replace_chunks(p_item uuid, p_chunks jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid;
  v_kind text;
  v_total int;
  v_embedded int;
begin
  select org_id, kind into v_org, v_kind from public.knowledge_items where id = p_item;
  if v_org is null or v_kind <> 'text' or auth.uid() is null or not public.has_org_role(v_org, array['admin', 'member']::public.org_role[]) then
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

-- ---------------------------------------------------------------- journal des ajouts
-- Chaque ajout de fichier ou de site, en ajout seul (supprimer une source ne libère pas le plafond du jour) : chaque lecture est facturée (vecteurs) et un site
-- fait des requêtes chez un tiers.
create table public.knowledge_source_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('file', 'website')),
  created_at timestamptz not null default now()
);
create index knowledge_source_log_org_idx on public.knowledge_source_log (org_id, created_at desc);
alter table public.knowledge_source_log enable row level security;
revoke all on public.knowledge_source_log from anon, authenticated;

-- ---------------------------------------------------------------- ajouter une source
-- Plafonds : 40 fichiers, 5 sites, 30 ajouts par jour et par organisation (et 100 sources en tout, par le déclencheur `knowledge_items_limit`).
create function public.knowledge_add_file(p_org uuid, p_path text, p_title text, p_size bigint default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_ext text;
  v_mime text;
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_size bigint := p_size;
  v_found int;
  v_id uuid;
begin
  if v_user is null or p_org is null or not public.has_org_role(p_org, array['admin', 'member']::public.org_role[]) then
    raise exception 'knowledge_forbidden' using errcode = '42501';
  end if;
  -- Le fichier est dans le dossier de l'organisation, directement : « <organisation>/<nom> ».
  if p_path is null or char_length(p_path) > char_length(p_org::text) + 301 or p_path !~ ('^' || p_org::text || '/[^/]+$') or p_path ~ '\.\.' then
    raise exception 'knowledge_invalid_path' using errcode = '22023';
  end if;
  if v_title = '' then
    raise exception 'knowledge_invalid_title' using errcode = '22023';
  end if;
  v_ext := lower(substring(p_path from '\.([A-Za-z0-9]{1,8})$'));
  v_mime := case v_ext
    when 'pdf' then 'application/pdf'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'txt' then 'text/plain'
    when 'md' then 'text/markdown'
    when 'markdown' then 'text/markdown'
    when 'csv' then 'text/csv'
    when 'html' then 'text/html'
    when 'htm' then 'text/html'
  end;
  if v_mime is null then
    raise exception 'knowledge_unsupported_type' using errcode = '22023';
  end if;

  -- Sur Supabase, le fichier doit exister dans le bucket, et sa taille réelle fait foi (celle qu'annonce le navigateur ne compte pas).
  if to_regclass('storage.objects') is not null then
    execute 'select count(*), max((metadata ->> ''size'')::bigint) from storage.objects where bucket_id = ''knowledge'' and name = $1'
      into v_found, v_size using p_path;
    if v_found = 0 then
      raise exception 'knowledge_file_missing' using errcode = '22023';
    end if;
  end if;
  if v_size is null or v_size < 1 then
    raise exception 'knowledge_file_missing' using errcode = '22023';
  end if;
  if v_size > 10485760 then
    raise exception 'knowledge_file_too_large' using errcode = '23514';
  end if;

  if (select count(*) from public.knowledge_items where org_id = p_org and kind = 'file') >= 40 then
    raise exception 'knowledge_files_limit' using errcode = '23514';
  end if;
  if (select count(*) from public.knowledge_source_log where org_id = p_org and created_at > now() - interval '1 day') >= 30 then
    raise exception 'knowledge_daily_limit' using errcode = '23514';
  end if;

  insert into public.knowledge_items (org_id, title, content, created_by, pinned, kind, status, file_path, mime_type, size_bytes, run_at)
  values (p_org, v_title, '', v_user, false, 'file', 'pending', p_path, v_mime, v_size, now())
  returning id into v_id;
  insert into public.knowledge_source_log (org_id, user_id, kind) values (p_org, v_user, 'file');
  return v_id;
end;
$$;

-- p_scope : 'page' (cette page seulement) ou 'site' (tout le site, 50 pages au plus). p_auto_sync : relire le site chaque semaine.
-- L'adresse n'est qu'à moitié contrôlée ici (http ou https, sans identifiants) : le worker refuse toute adresse non publique avant d'y toucher (SSRF).
create function public.knowledge_add_website(p_org uuid, p_url text, p_title text, p_scope text default 'site', p_auto_sync boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_url text := btrim(coalesce(p_url, ''));
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_id uuid;
begin
  if v_user is null or p_org is null or not public.has_org_role(p_org, array['admin', 'member']::public.org_role[]) then
    raise exception 'knowledge_forbidden' using errcode = '42501';
  end if;
  if char_length(v_url) > 2000 or v_url !~* '^https?://[^/?#@\s]+' or v_url ~* '^https?://[^/?#]*@' or v_url ~ '[[:cntrl:][:space:]]' then
    raise exception 'knowledge_invalid_url' using errcode = '22023';
  end if;
  if p_scope is null or p_scope not in ('page', 'site') then
    raise exception 'knowledge_invalid_scope' using errcode = '22023';
  end if;
  if v_title = '' then
    raise exception 'knowledge_invalid_title' using errcode = '22023';
  end if;
  if exists (select 1 from public.knowledge_items where org_id = p_org and kind = 'website' and lower(rtrim(url, '/')) = lower(rtrim(v_url, '/'))) then
    raise exception 'knowledge_duplicate' using errcode = '23505';
  end if;
  if (select count(*) from public.knowledge_items where org_id = p_org and kind = 'website') >= 5 then
    raise exception 'knowledge_sites_limit' using errcode = '23514';
  end if;
  if (select count(*) from public.knowledge_source_log where org_id = p_org and created_at > now() - interval '1 day') >= 30 then
    raise exception 'knowledge_daily_limit' using errcode = '23514';
  end if;

  insert into public.knowledge_items (org_id, title, content, created_by, pinned, kind, status, url, config, run_at)
  values (p_org, v_title, '', v_user, false, 'website', 'pending', v_url,
          jsonb_build_object('scope', p_scope, 'autoSync', coalesce(p_auto_sync, true), 'maxPages', 50), now())
  returning id into v_id;
  insert into public.knowledge_source_log (org_id, user_id, kind) values (p_org, v_user, 'website');
  return v_id;
end;
$$;

-- « Actualiser » : remet la source dans la file. Rend faux si elle y est déjà (en attente ou en cours de lecture). Un délai de 10 minutes sépare deux demandes.
create function public.knowledge_request_sync(p_item uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_item public.knowledge_items;
begin
  select * into v_item from public.knowledge_items where id = p_item for update;
  if not found or v_item.kind = 'text' or auth.uid() is null or not public.has_org_role(v_item.org_id, array['admin', 'member']::public.org_role[]) then
    raise exception 'knowledge_forbidden' using errcode = '42501';
  end if;
  if v_item.status in ('pending', 'processing') then
    return false;
  end if;
  if v_item.requested_at is not null and v_item.requested_at > now() - interval '10 minutes' then
    raise exception 'knowledge_sync_too_soon' using errcode = '23514';
  end if;
  update public.knowledge_items
     set status = 'pending', error = null, attempts = 0, run_at = now(), locked_until = null, requested_at = now()
   where id = p_item;
  return true;
end;
$$;

-- Les pages lues d'une source de type site : adresse, titre, empreinte du texte, passages et passages vectorisés. Sous la RLS de l'appelant (lecture pour les membres).
create function public.knowledge_source_pages(p_item uuid)
returns table (url text, title text, hash text, chunks int, embedded int)
language sql stable set search_path = public as $$
  select c.meta ->> 'url', max(c.meta ->> 'title'), max(c.meta ->> 'hash'), count(*)::int, count(c.embedding)::int
  from public.knowledge_chunks c
  where c.item_id = p_item and c.meta ? 'url'
  group by c.meta ->> 'url'
  order by c.meta ->> 'url'
$$;

-- ---------------------------------------------------------------- le worker
-- Réclame les sources à lire : en attente (dont l'échéance est venue), prêtes à relire (sites, chaque semaine), ou abandonnées en cours de lecture (le verrou a expiré).
-- Une source abandonnée trois fois est déclarée en échec. Un seul worker lit une source à la fois (`for update skip locked`).
create function public.claim_knowledge_sources(p_limit int default 1, p_lock_seconds int default 180)
returns table (id uuid, org_id uuid, kind text, title text, url text, file_path text, config jsonb, attempts int, chunk_count int)
language plpgsql security definer set search_path = public as $$
begin
  update public.knowledge_items k
     set status = case when k.chunk_count > 0 then 'ready' else 'failed' end, error = 'timeout', locked_until = null,
         run_at = case when k.kind = 'website' and k.chunk_count > 0 and coalesce((k.config ->> 'autoSync')::boolean, true) then now() + interval '7 days' end
   where k.kind <> 'text' and k.status = 'processing' and k.locked_until < now() and k.attempts >= 3;

  return query
  with due as (
    select k.id from public.knowledge_items k
    where k.kind <> 'text'
      and ((k.status = 'pending' and coalesce(k.run_at, now()) <= now())
        or (k.status = 'ready' and k.run_at is not null and k.run_at <= now())
        or (k.status = 'processing' and k.locked_until < now() and k.attempts < 3))
    order by coalesce(k.run_at, k.created_at), k.created_at
    limit greatest(coalesce(p_limit, 1), 1)
    for update skip locked
  ),
  locked as (
    update public.knowledge_items k
       set status = 'processing', locked_until = now() + make_interval(secs => greatest(coalesce(p_lock_seconds, 180), 30)), attempts = k.attempts + 1, error = null
      from due
     where k.id = due.id
    returning k.id, k.org_id, k.kind, k.title, k.url, k.file_path, k.config, k.attempts, k.chunk_count
  )
  select l.id, l.org_id, l.kind, l.title, l.url, l.file_path, l.config, l.attempts, l.chunk_count from locked l;
end;
$$;

-- Prolonge le verrou d'une source en cours de lecture (une lecture de site dure plusieurs minutes).
create function public.knowledge_source_touch(p_item uuid, p_lock_seconds int default 180) returns void
language sql security definer set search_path = public as $$
  update public.knowledge_items
     set locked_until = now() + make_interval(secs => greatest(coalesce(p_lock_seconds, 180), 30))
   where id = p_item and kind <> 'text' and status = 'processing'
$$;

-- Écrit les passages d'une source. p_replace : remplace tous les passages (fichier) ; sinon retire ceux des pages p_drop (repérées par meta.url) et ajoute les nouveaux
-- (site, par lots). Au plus 400 passages par source et 3 000 par organisation. Rend le nombre de passages de la source.
-- p_chunks : [{ "content": "…", "embedding": [1024 nombres] | null, "meta": {…} }, …].
create function public.knowledge_source_write(p_item uuid, p_chunks jsonb, p_replace boolean default false, p_drop text[] default '{}') returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid;
  v_kind text;
  v_base int;
  v_total int;
  v_embedded int;
begin
  select org_id, kind into v_org, v_kind from public.knowledge_items where id = p_item for update;
  if v_org is null or v_kind = 'text' then
    raise exception 'knowledge_forbidden' using errcode = '42501';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'knowledge_source_write : p_chunks doit être un tableau' using errcode = '22023';
  end if;

  if p_replace then
    delete from public.knowledge_chunks where item_id = p_item;
  elsif coalesce(array_length(p_drop, 1), 0) > 0 then
    delete from public.knowledge_chunks where item_id = p_item and meta ->> 'url' = any (p_drop);
  end if;

  select count(*) into v_total from public.knowledge_chunks where item_id = p_item;
  if v_total + jsonb_array_length(p_chunks) > 400 then
    raise exception 'knowledge_item_chunks_limit' using errcode = '23514';
  end if;
  if (select count(*) from public.knowledge_chunks where org_id = v_org and item_id <> p_item) + v_total + jsonb_array_length(p_chunks) > 3000 then
    raise exception 'knowledge_chunks_limit' using errcode = '23514';
  end if;

  select coalesce(max(ord), -1) into v_base from public.knowledge_chunks where item_id = p_item;
  insert into public.knowledge_chunks (org_id, item_id, ord, content, embedding, meta)
  select v_org, p_item, v_base + c.ord::int, c.value ->> 'content',
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

-- Clôt une lecture réussie : aperçu (début du texte, pour la liste), chiffres, date, prochaine lecture dans p_next_seconds (null : aucune).
create function public.knowledge_source_complete(p_item uuid, p_preview text, p_stats jsonb, p_next_seconds int default null) returns void
language sql security definer set search_path = public as $$
  update public.knowledge_items
     set status = 'ready', error = null, attempts = 0, locked_until = null, synced_at = now(),
         content = case when coalesce(p_preview, '') = '' then content else left(p_preview, 2000) end,
         stats = case when jsonb_typeof(p_stats) = 'object' then p_stats else '{}'::jsonb end,
         run_at = case when p_next_seconds is null then null else now() + make_interval(secs => p_next_seconds) end
   where id = p_item and kind <> 'text'
$$;

-- Clôt une lecture ratée. Panne passagère (p_transient) avant le troisième essai : la source retourne en file, relue dans p_retry_seconds. Sinon la lecture est abandonnée :
-- « failed » si la source n'a rien d'utilisable, « ready » avec l'erreur si elle gardait des passages d'une lecture précédente (qui restent cherchables) ; un site garde
-- alors sa relecture hebdomadaire. p_error est un code (voir SOURCE_ERRORS).
create function public.knowledge_source_fail(p_item uuid, p_error text, p_transient boolean default false, p_retry_seconds int default 1800, p_stats jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item public.knowledge_items;
  v_error text := case when p_error ~ '^[a-z_]{1,40}$' then p_error else 'internal' end;
begin
  select * into v_item from public.knowledge_items where id = p_item and kind <> 'text' for update;
  if not found then
    return;
  end if;
  if p_transient and v_item.attempts < 3 then
    update public.knowledge_items
       set status = 'pending', error = v_error, locked_until = null, run_at = now() + make_interval(secs => greatest(coalesce(p_retry_seconds, 1800), 60)),
           stats = case when jsonb_typeof(p_stats) = 'object' then p_stats else stats end
     where id = p_item;
  else
    update public.knowledge_items
       set status = case when v_item.chunk_count > 0 then 'ready' else 'failed' end, error = v_error, attempts = 0, locked_until = null,
           run_at = case when v_item.kind = 'website' and v_item.chunk_count > 0 and coalesce((v_item.config ->> 'autoSync')::boolean, true) then now() + interval '7 days' end,
           stats = case when jsonb_typeof(p_stats) = 'object' then p_stats else stats end
     where id = p_item;
  end if;
end;
$$;

-- ---------------------------------------------------------------- droits
revoke execute on function public.knowledge_add_file(uuid, text, text, bigint) from public, anon;
revoke execute on function public.knowledge_add_website(uuid, text, text, text, boolean) from public, anon;
revoke execute on function public.knowledge_request_sync(uuid) from public, anon;
revoke execute on function public.knowledge_source_pages(uuid) from public, anon;
revoke execute on function public.knowledge_replace_chunks(uuid, jsonb) from public, anon;
grant execute on function public.knowledge_add_file(uuid, text, text, bigint) to authenticated, service_role;
grant execute on function public.knowledge_add_website(uuid, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.knowledge_request_sync(uuid) to authenticated, service_role;
grant execute on function public.knowledge_source_pages(uuid) to authenticated, service_role;
grant execute on function public.knowledge_replace_chunks(uuid, jsonb) to authenticated, service_role;

-- Le worker seul lit et écrit les sources de type fichier ou site.
revoke execute on function public.claim_knowledge_sources(int, int) from public, anon, authenticated;
revoke execute on function public.knowledge_source_touch(uuid, int) from public, anon, authenticated;
revoke execute on function public.knowledge_source_write(uuid, jsonb, boolean, text[]) from public, anon, authenticated;
revoke execute on function public.knowledge_source_complete(uuid, text, jsonb, int) from public, anon, authenticated;
revoke execute on function public.knowledge_source_fail(uuid, text, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.claim_knowledge_sources(int, int) to service_role;
grant execute on function public.knowledge_source_touch(uuid, int) to service_role;
grant execute on function public.knowledge_source_write(uuid, jsonb, boolean, text[]) to service_role;
grant execute on function public.knowledge_source_complete(uuid, text, jsonb, int) to service_role;
grant execute on function public.knowledge_source_fail(uuid, text, boolean, int, jsonb) to service_role;

-- ---------------------------------------------------------------- stockage des fichiers (présent seulement sur Supabase)
-- Un bucket privé : « <organisation>/<uuid>-<nom> ». Le navigateur y dépose le fichier avec la session de l'utilisateur, puis `knowledge_add_file` l'enregistre.
-- 10 Mo au plus et seulement les types que la lecture sait traiter.
do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('knowledge', 'knowledge', false, 10485760, array[
      'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown', 'text/csv', 'text/html'
    ])
    on conflict (id) do nothing;

    execute $p$
      create policy knowledge_objects_select on storage.objects for select to authenticated
      using (bucket_id = 'knowledge' and public.is_org_member(((storage.foldername(name))[1])::uuid))
    $p$;
    execute $p$
      create policy knowledge_objects_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'knowledge'
        and public.has_org_role(((storage.foldername(name))[1])::uuid, array['admin','member']::public.org_role[]))
    $p$;
    execute $p$
      create policy knowledge_objects_delete on storage.objects for delete to authenticated
      using (bucket_id = 'knowledge'
        and public.has_org_role(((storage.foldername(name))[1])::uuid, array['admin','member']::public.org_role[]))
    $p$;
  end if;
end;
$$;
