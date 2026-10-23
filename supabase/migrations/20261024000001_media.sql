-- Postbiz : bibliothèque de médias utilisée par les publications.
--  - la table `media` gagne un nom d'origine, un texte alternatif et un type (image / vidéo) ;
--  - un membre peut modifier le nom et le texte alternatif de ses médias ;
--  - `posts.media` ne peut référencer que des médias de la même organisation (sinon un client pourrait faire signer au worker le fichier d'une autre) ;
--  - `media_usage` dit combien de publications en attente utilisent un média (supprimer un média utilisé est refusé par l'application).
--
-- Forme de `posts.media` : [{ "media_id": "<uuid>", "type": "image" | "video", "alt": "<texte alternatif ou absent>" }]. Le chemin du fichier n'y est pas
-- copié : le worker le relit dans `media` au moment de publier.

alter table public.media
  add column name text check (name is null or char_length(name) <= 255),
  add column alt text check (alt is null or char_length(alt) <= 1500),
  add column kind text generated always as (case when mime_type like 'video/%' then 'video' else 'image' end) stored;

create policy media_update on public.media for update to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
-- Seules ces deux colonnes : le chemin et l'organisation ne doivent jamais bouger (le worker signe le fichier désigné par `path`).
revoke update on public.media from authenticated;
grant update (name, alt) on public.media to authenticated;

-- Un média ne peut être enregistré que pour un fichier du dossier de son organisation (« <org>/… » dans le bucket « media ») : sinon on pourrait
-- déclarer le fichier d'une autre organisation comme sien, et le worker le publierait.
drop policy media_insert on public.media;
create policy media_insert on public.media for insert to authenticated
  with check (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and created_by = auth.uid()
    and bucket = 'media'
    and split_part(path, '/', 1) = org_id::text
    and (normalized_path is null or split_part(normalized_path, '/', 1) = org_id::text)
    and (thumbnail_path is null or split_part(thumbnail_path, '/', 1) = org_id::text)
  );

create function public.posts_media_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  mid uuid;
begin
  if tg_op = 'UPDATE' and new.media is not distinct from old.media then
    return new;
  end if;
  if new.media is null or jsonb_typeof(new.media) <> 'array' then
    raise exception 'posts.media doit être un tableau' using errcode = '22023';
  end if;
  if jsonb_array_length(new.media) > 20 then
    raise exception 'trop de médias (20 au maximum)' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(new.media) loop
    begin
      mid := (item ->> 'media_id')::uuid;
    exception when others then
      raise exception 'media_id invalide' using errcode = '22023';
    end;
    if mid is null or not exists (select 1 from public.media m where m.id = mid and m.org_id = new.org_id) then
      raise exception 'un média n''appartient pas à cette organisation' using errcode = '23503';
    end if;
  end loop;
  return new;
end;
$$;

create trigger posts_media_guard before insert or update on public.posts
  for each row execute function public.posts_media_guard();

-- Publications en attente (brouillon ou programmée, non supprimée) qui utilisent chacun de ces médias. Respecte les droits de l'appelant.
create function public.media_usage(p_ids uuid[]) returns table (media_id uuid, post_count int)
language sql stable set search_path = public as $$
  select m.id, count(p.id)::int
  from unnest(p_ids) as m(id)
  left join public.posts p
    on p.deleted_at is null
   and p.state in ('draft', 'queued')
   and p.media @> jsonb_build_array(jsonb_build_object('media_id', m.id::text))
  group by m.id;
$$;
revoke execute on function public.media_usage(uuid[]) from public, anon;
grant execute on function public.media_usage(uuid[]) to authenticated, service_role;
