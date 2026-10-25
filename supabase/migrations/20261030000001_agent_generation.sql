-- Postbiz : génération d'images et de vidéos par l'agent (page « Agent » du site et onglet Agent du mobile).
--  - `ai_generations` : journal en ajout seul des générations, pour plafonner leur nombre par organisation et par jour (chaque image et chaque vidéo est
--    facturée par le fournisseur). Compter les médias ne suffirait pas : supprimer l'image générée effacerait la trace de son coût ;
--  - `ai_generation_reserve` : réserve une génération sous le plafond, de façon atomique (deux demandes simultanées ne passent pas toutes les deux) ;
--  - `ai_video_jobs` : les vidéos prennent plusieurs minutes, bien plus qu'une réponse de l'agent : la tâche est gardée ici, le navigateur ou le mobile
--    l'interroge, et la vidéo terminée est enregistrée dans la médiathèque. Une tâche est privée à son auteur, comme sa conversation ;
--  - `agent_messages.job_ids` : les tâches lancées par un message de l'agent (leur état se lit dans `ai_video_jobs`, il change après coup).

alter table public.agent_messages
  add column job_ids jsonb not null default '[]' check (jsonb_typeof(job_ids) = 'array' and jsonb_array_length(job_ids) <= 20);

-- ---------------------------------------------------------------- journal des générations
create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  created_at timestamptz not null default now()
);

create index ai_generations_quota_idx on public.ai_generations (org_id, kind, created_at desc);

alter table public.ai_generations enable row level security;
revoke all on public.ai_generations from anon;
-- Ajout seul : aucun client ne modifie ni n'efface une ligne (sinon un plafond se contournerait en effaçant la trace).
revoke update, delete on public.ai_generations from authenticated;

create policy ai_generations_select on public.ai_generations for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy ai_generations_insert on public.ai_generations for insert to authenticated
  with check (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));

-- Réserve une génération : vrai (et une ligne ajoutée) si l'organisation en a lancé moins de `p_limit` du même type sur les dernières 24 heures.
-- Le verrou est pris par organisation et par type : sans lui, deux demandes simultanées liraient le même total et passeraient toutes les deux.
create function public.ai_generation_reserve(p_org uuid, p_kind text, p_limit int) returns boolean
language plpgsql set search_path = public as $$
declare
  used int;
begin
  if p_kind not in ('image', 'video') or p_limit is null or p_limit < 0 then
    raise exception 'ai_generation_reserve : paramètres invalides' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.has_org_role(p_org, array['admin', 'member']::public.org_role[]) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_kind, 0));
  select count(*) into used from public.ai_generations
    where org_id = p_org and kind = p_kind and created_at > now() - interval '24 hours';
  if used >= p_limit then
    return false;
  end if;
  insert into public.ai_generations (org_id, user_id, kind) values (p_org, auth.uid(), p_kind);
  return true;
end;
$$;
revoke execute on function public.ai_generation_reserve(uuid, text, int) from public, anon;
grant execute on function public.ai_generation_reserve(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------- tâches de génération vidéo
-- `status` : pending (en cours chez le fournisseur), saving (une requête télécharge la vidéo terminée et l'enregistre : un seul « saving » à la fois),
-- completed, failed.
create table public.ai_video_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 2000),
  orientation text not null check (orientation in ('vertical', 'horizontal')),
  provider_task_id text not null check (char_length(provider_task_id) between 1 and 200),
  reference_media_ids jsonb not null default '[]' check (jsonb_typeof(reference_media_ids) = 'array' and jsonb_array_length(reference_media_ids) <= 3),
  status text not null default 'pending' check (status in ('pending', 'saving', 'completed', 'failed')),
  error text check (error is null or char_length(error) <= 500),
  media_id uuid references public.media (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_video_jobs_owner_idx on public.ai_video_jobs (org_id, created_by, created_at desc);

create trigger ai_video_jobs_updated_at before update on public.ai_video_jobs
  for each row execute function public.set_updated_at();

-- Une vidéo ne peut être rattachée qu'à un média de la même organisation ; et une personne ne fait pas courir plus de trois vidéos à la fois.
create function public.ai_video_jobs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.media_id is not null and not exists (select 1 from public.media m where m.id = new.media_id and m.org_id = new.org_id) then
    raise exception 'un média n''appartient pas à cette organisation' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' and (
    select count(*) from public.ai_video_jobs j where j.created_by = new.created_by and j.status in ('pending', 'saving')
  ) >= 3 then
    raise exception 'ai_video_jobs_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger ai_video_jobs_guard before insert or update on public.ai_video_jobs
  for each row execute function public.ai_video_jobs_guard();

alter table public.ai_video_jobs enable row level security;
revoke all on public.ai_video_jobs from anon;
-- Un client ne fait avancer que l'état de sa tâche : jamais le texte, l'organisation, l'auteur ni l'identifiant chez le fournisseur.
revoke update on public.ai_video_jobs from authenticated;
grant update (status, error, media_id, claimed_at) on public.ai_video_jobs to authenticated;
revoke delete on public.ai_video_jobs from authenticated;

create policy ai_video_jobs_select on public.ai_video_jobs for select to authenticated
  using (created_by = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy ai_video_jobs_insert on public.ai_video_jobs for insert to authenticated
  with check (created_by = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy ai_video_jobs_update on public.ai_video_jobs for update to authenticated
  using (created_by = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]))
  with check (created_by = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
