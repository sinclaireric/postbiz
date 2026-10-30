-- Les plafonds de la base de connaissance suivent l'offre de l'espace de travail (voir 20261103000001_billing.sql : `plan_limits`, `org_plan_limit`).
--
-- Tant que la facturation est désactivée (bêta gratuite), `org_plan_limit` rend « illimité » (null) : les plafonds de sécurité d'avant restent en vigueur, rien ne change
-- (40 documents, 5 sites, 100 sources en tout, 3 000 passages). Une fois la facturation activée, l'offre fixe le nombre de documents (`knowledge_files`) et de sites
-- (`knowledge_sites`), et les plafonds globaux la suivent pour que ces places soient utilisables :
--   - sources (fiches de texte, documents et sites) : au moins 100, et de quoi loger les documents et les sites de l'offre avec 50 fiches de texte ;
--   - passages : au moins 3 000, et 150 par document ou site de l'offre.
-- Les refus portent le plafond atteint dans leur message (« knowledge_files_limit:20 ») pour que le site le dise.

-- ---------------------------------------------------------------- prérequis
-- Cette migration s'appuie sur les offres et leurs plafonds (org_plan_limit : 20261103000001_billing.sql) et remplace des fonctions des sources de connaissance
-- (20261105000001_knowledge_sources.sql). Si l'une manque, on le dit clairement, avant de créer ou de remplacer quoi que ce soit.
do $$
begin
  if to_regprocedure('public.org_plan_limit(uuid,text)') is null then
    raise exception 'Prérequis manquant : appliquez d''abord supabase/migrations/20261103000001_billing.sql (offres et plafonds), dans l''ordre.' using errcode = '42883';
  end if;
  if to_regclass('public.knowledge_source_log') is null
     or to_regprocedure('public.knowledge_add_file(uuid,text,text,bigint)') is null
     or to_regprocedure('public.knowledge_add_website(uuid,text,text,text,boolean)') is null
     or to_regprocedure('public.knowledge_source_write(uuid,jsonb,boolean,text[])') is null then
    raise exception 'Prérequis manquant : appliquez d''abord supabase/migrations/20261105000001_knowledge_sources.sql (documents et sites), dans l''ordre.' using errcode = '42883';
  end if;
end;
$$;

-- Les limites de l'espace : documents, sites, sources, passages, et `upgradable` (vrai : elles viennent de l'offre et une offre supérieure les relèverait, le site propose alors
-- d'en changer ; faux en bêta gratuite et pour l'offre la plus haute). Réservé aux membres de l'espace (et au service), comme `org_plan_limit`.
create function public.knowledge_org_limits(p_org uuid) returns table (files int, sites int, sources int, chunks int, upgradable boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_files int := public.org_plan_limit(p_org, 'knowledge_files');
  v_sites int := public.org_plan_limit(p_org, 'knowledge_sites');
  v_planned boolean := v_files is not null or v_sites is not null;
begin
  files := coalesce(v_files, 40);
  sites := coalesce(v_sites, 5);
  sources := case when v_planned then greatest(100, files + sites + 50) else 100 end;
  chunks := case when v_planned then greatest(3000, 150 * (files + sites)) else 3000 end;
  upgradable := v_planned and exists (
    select 1 from public.plan_limits p
    where (p.key = 'knowledge_files' and (p.value is null or p.value > files)) or (p.key = 'knowledge_sites' and (p.value is null or p.value > sites))
  );
  return next;
end;
$$;
revoke execute on function public.knowledge_org_limits(uuid) from public, anon;
grant execute on function public.knowledge_org_limits(uuid) to authenticated, service_role;

-- Le nombre de sources de l'espace (la fiche de texte, le document et le site comptent chacun pour une).
create or replace function public.knowledge_items_limit() returns trigger
language plpgsql as $$
declare
  v_max int;
begin
  -- Le déclencheur passe avant la sécurité par lignes : quelqu'un qui n'est pas de l'espace n'a pas à lire son offre, c'est la politique de la table qui le refuse (comme avant).
  if auth.uid() is not null and not public.is_org_member(new.org_id) then
    return new;
  end if;
  select l.sources into v_max from public.knowledge_org_limits(new.org_id) l;
  if (select count(*) from public.knowledge_items k where k.org_id = new.org_id) >= v_max then
    raise exception 'knowledge_items_limit:%', v_max using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- ajouter une source (mêmes fonctions qu'avant, avec le plafond de l'offre)
create or replace function public.knowledge_add_file(p_org uuid, p_path text, p_title text, p_size bigint default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_ext text;
  v_mime text;
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_size bigint := p_size;
  v_found int;
  v_id uuid;
  v_limit int;
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

  select l.files into v_limit from public.knowledge_org_limits(p_org) l;
  if (select count(*) from public.knowledge_items where org_id = p_org and kind = 'file') >= v_limit then
    raise exception 'knowledge_files_limit:%', v_limit using errcode = '23514';
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

create or replace function public.knowledge_add_website(p_org uuid, p_url text, p_title text, p_scope text default 'site', p_auto_sync boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_url text := btrim(coalesce(p_url, ''));
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_id uuid;
  v_limit int;
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
  select l.sites into v_limit from public.knowledge_org_limits(p_org) l;
  if (select count(*) from public.knowledge_items where org_id = p_org and kind = 'website') >= v_limit then
    raise exception 'knowledge_sites_limit:%', v_limit using errcode = '23514';
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

-- ---------------------------------------------------------------- écrire les passages (mêmes fonctions qu'avant, avec le plafond de l'offre)
create or replace function public.knowledge_replace_chunks(p_item uuid, p_chunks jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid;
  v_kind text;
  v_total int;
  v_embedded int;
  v_cap int;
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
  select l.chunks into v_cap from public.knowledge_org_limits(v_org) l;
  if (select count(*) from public.knowledge_chunks where org_id = v_org and item_id <> p_item) + jsonb_array_length(p_chunks) > v_cap then
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

create or replace function public.knowledge_source_write(p_item uuid, p_chunks jsonb, p_replace boolean default false, p_drop text[] default '{}') returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid;
  v_kind text;
  v_base int;
  v_total int;
  v_embedded int;
  v_cap int;
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
  select l.chunks into v_cap from public.knowledge_org_limits(v_org) l;
  if (select count(*) from public.knowledge_chunks where org_id = v_org and item_id <> p_item) + v_total + jsonb_array_length(p_chunks) > v_cap then
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
