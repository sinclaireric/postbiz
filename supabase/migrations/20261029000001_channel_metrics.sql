-- Postbiz : statistiques d'audience des canaux (abonnés, portée, interactions), relevées chaque jour par le worker auprès des réseaux
-- (Facebook, Instagram, Page LinkedIn, YouTube ; abonnés seulement pour TikTok et X). Alimente la page Analyses.
--
--  * channel_metrics_daily : une valeur par canal, par jour (UTC) et par métrique. « followers » est un niveau (total en fin de journée),
--                            « reach » et « engagement » des quantités par jour. Lecture pour les membres de l'organisation, écriture
--                            réservée au worker (aucune policy d'écriture : seul le service_role passe, par record_channel_metrics).
--  * channel_metrics_sync  : où en est la collecte de chaque canal (prochaine tentative, verrou, dernier résultat). Un canal dont le jeton
--                            n'a pas reçu l'autorisation « statistiques » est marqué « missing_scope » : la page demande de le reconnecter.

-- ---------------------------------------------------------------- relevés quotidiens
create table public.channel_metrics_daily (
  integration_id uuid not null references public.integrations (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  metric text not null check (metric in ('followers', 'reach', 'engagement')),
  value bigint not null check (value >= 0),
  collected_at timestamptz not null default now(),
  primary key (integration_id, day, metric)
);
create index channel_metrics_daily_org_idx on public.channel_metrics_daily (org_id, day);

-- ---------------------------------------------------------------- suivi de la collecte
create table public.channel_metrics_sync (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- pending : jamais collecté ; ok : dernière collecte réussie ; missing_scope : le réseau refuse faute d'autorisation (reconnecter) ;
  -- error : échec passager (réseau, 5xx, quota), on réessaie avec un délai croissant.
  status text not null default 'pending' check (status in ('pending', 'ok', 'missing_scope', 'error')),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  -- Le premier passage remonte l'historique disponible (jusqu'à 90 jours) ; les suivants ne relisent que les derniers jours.
  backfilled_at timestamptz,
  error text check (error is null or char_length(error) <= 300)
);
create index channel_metrics_sync_due_idx on public.channel_metrics_sync (next_attempt_at);

alter table public.channel_metrics_daily enable row level security;
alter table public.channel_metrics_sync enable row level security;
revoke all on public.channel_metrics_daily, public.channel_metrics_sync from anon;
revoke insert, update, delete, truncate on public.channel_metrics_daily, public.channel_metrics_sync from authenticated;

create policy channel_metrics_daily_select on public.channel_metrics_daily for select to authenticated
  using (public.is_org_member(org_id));
create policy channel_metrics_sync_select on public.channel_metrics_sync for select to authenticated
  using (public.is_org_member(org_id));

-- ---------------------------------------------------------------- collecte (worker)
-- Réclame les canaux dont la collecte est due. Les canaux actifs qui n'ont pas encore de ligne de suivi en reçoivent une (due tout de suite :
-- un canal qui vient d'être connecté est collecté au passage suivant). Le verrou évite que deux workers relèvent le même canal.
create function public.claim_metrics_sync(p_providers public.social_provider[], p_limit int default 10, p_lock_seconds int default 600)
returns table (id uuid, org_id uuid, provider public.social_provider, name text, internal_id text, settings jsonb, attempts int, backfilled boolean)
language plpgsql security definer set search_path = public as $$
begin
  insert into public.channel_metrics_sync (integration_id, org_id)
  select i.id, i.org_id
  from public.integrations i
  where i.status = 'active' and i.deleted_at is null and i.provider = any (p_providers)
  on conflict (integration_id) do nothing;

  return query
  with picked as (
    select s.integration_id
    from public.channel_metrics_sync s
    join public.integrations i on i.id = s.integration_id
    join public.integration_secrets k on k.integration_id = i.id
    where i.status = 'active'
      and i.deleted_at is null
      and i.provider = any (p_providers)
      and s.next_attempt_at <= now()
      and (s.locked_until is null or s.locked_until < now())
    order by s.next_attempt_at
    limit p_limit
    for update of s skip locked
  ),
  locked as (
    update public.channel_metrics_sync s
    set locked_until = now() + make_interval(secs => p_lock_seconds), last_attempt_at = now()
    from picked
    where s.integration_id = picked.integration_id
    returning s.integration_id, s.attempts, s.backfilled_at
  )
  select i.id, i.org_id, i.provider, i.name, i.internal_id, i.settings, l.attempts, l.backfilled_at is not null
  from locked l
  join public.integrations i on i.id = l.integration_id;
end;
$$;

-- Enregistre des relevés : [{ "day": "2026-10-24", "metric": "reach", "value": 1234 }, ...]. L'organisation vient du canal (jamais de
-- l'appelant), un relevé du même jour est remplacé (le jour en cours se corrige d'une collecte à l'autre). Un canal supprimé est ignoré.
-- Renvoie le nombre de relevés écrits.
create function public.record_channel_metrics(p_integration uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'relevés invalides' using errcode = '22023';
  end if;
  with written as (
    insert into public.channel_metrics_daily (integration_id, org_id, day, metric, value)
    select i.id, i.org_id, r.day, r.metric, round(r.value)::bigint
    from public.integrations i,
         jsonb_to_recordset(p_rows) as r (day date, metric text, value numeric)
    where i.id = p_integration and i.deleted_at is null
      and r.day is not null and r.metric is not null and r.value is not null and r.value >= 0
    on conflict (integration_id, day, metric) do update set value = excluded.value, collected_at = now()
    returning 1
  )
  select count(*) into v_count from written;
  return v_count;
end;
$$;

-- La collecte s'est bien passée (au moins pour une partie des métriques) : prochaine tentative dans p_next_seconds.
create function public.complete_metrics_sync(p_integration uuid, p_next_seconds int, p_backfilled boolean default false) returns void
language sql security definer set search_path = public as $$
  update public.channel_metrics_sync
  set status = 'ok', error = null, attempts = 0, locked_until = null,
      last_success_at = now(),
      next_attempt_at = now() + make_interval(secs => greatest(p_next_seconds, 60)),
      backfilled_at = coalesce(backfilled_at, case when p_backfilled then now() end)
  where integration_id = p_integration;
$$;

-- La collecte a échoué (ou n'a réussi qu'en partie) : « missing_scope » ou « error », avec un message court et la prochaine tentative.
create function public.fail_metrics_sync(p_integration uuid, p_status text, p_error text, p_next_seconds int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('missing_scope', 'error') then
    raise exception 'statut inconnu : %', p_status using errcode = '22023';
  end if;
  update public.channel_metrics_sync
  set status = p_status, error = left(p_error, 300), attempts = attempts + 1, locked_until = null,
      next_attempt_at = now() + make_interval(secs => greatest(p_next_seconds, 60))
  where integration_id = p_integration;
end;
$$;

-- Réservées au worker.
do $$
declare
  f text;
begin
  for f in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('claim_metrics_sync', 'record_channel_metrics', 'complete_metrics_sync', 'fail_metrics_sync')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
