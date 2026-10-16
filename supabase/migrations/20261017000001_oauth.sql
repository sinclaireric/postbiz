-- Postbiz : connexion des canaux par OAuth.
--  * oauth_states               : état de chaque connexion en cours (anti-CSRF, PKCE), lié à l'utilisateur et à l'organisation
--  * oauth_pending_selections   : comptes Meta trouvés, en attente du choix de l'utilisateur (jetons chiffrés)
--  * connect_integration / disconnect_integration : écritures atomiques d'un canal et de son jeton
--  * claim_token_refresh & co   : rafraîchissement des jetons par le worker
-- Aucune de ces tables n'est accessible aux clients (ni anon ni authenticated) : tout passe par le service_role.

-- ---------------------------------------------------------------- connexions en cours
create table public.oauth_states (
  state_hash text primary key,                 -- SHA-256 du paramètre `state` (jamais le state lui-même)
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  network public.social_provider not null,
  code_verifier_enc text,                      -- PKCE, chiffré côté applicatif ; null si le réseau n'utilise pas PKCE
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index oauth_states_expiry_idx on public.oauth_states (expires_at);

create table public.oauth_pending_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  network public.social_provider not null,
  payload_enc text not null,                   -- comptes proposés + jetons de Page, chiffrés (AES-GCM)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create index oauth_pending_expiry_idx on public.oauth_pending_selections (expires_at);

alter table public.oauth_states enable row level security;
alter table public.oauth_pending_selections enable row level security;
revoke all on public.oauth_states, public.oauth_pending_selections from anon, authenticated;

-- ---------------------------------------------------------------- verrou de rafraîchissement
alter table public.integrations add column refresh_locked_until timestamptz;

-- ---------------------------------------------------------------- création / mise à jour d'un canal
-- Atomique : le canal et son jeton sont écrits ensemble ou pas du tout. Une reconnexion réactive un canal
-- supprimé ou à reconnecter. Les réglages existants sont conservés (fusionnés avec les nouveaux).
create function public.connect_integration(
  p_org uuid,
  p_provider public.social_provider,
  p_internal_id text,
  p_name text,
  p_username text,
  p_picture_url text,
  p_settings jsonb,
  p_token_expires_at timestamptz,
  p_access_token_enc text,
  p_refresh_token_enc text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.integrations (org_id, provider, internal_id, name, username, picture_url, settings, token_expires_at, status)
  values (p_org, p_provider, p_internal_id, p_name, p_username, p_picture_url, coalesce(p_settings, '{}'::jsonb), p_token_expires_at, 'active')
  on conflict (org_id, provider, internal_id) do update set
    name = excluded.name,
    username = excluded.username,
    picture_url = excluded.picture_url,
    settings = public.integrations.settings || excluded.settings,
    token_expires_at = excluded.token_expires_at,
    status = 'active',
    deleted_at = null,
    refresh_locked_until = null
  returning id into v_id;

  insert into public.integration_secrets (integration_id, access_token_enc, refresh_token_enc)
  values (v_id, p_access_token_enc, p_refresh_token_enc)
  on conflict (integration_id) do update set
    access_token_enc = excluded.access_token_enc,
    refresh_token_enc = coalesce(excluded.refresh_token_enc, public.integration_secrets.refresh_token_enc);

  return v_id;
end;
$$;

-- Retire un canal : jetons supprimés, canal marqué supprimé, publications en attente passées en erreur
-- (sinon elles resteraient « queued » à jamais, le worker ne traitant que les canaux actifs).
create function public.disconnect_integration(p_org uuid, p_integration uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_found boolean;
begin
  update public.integrations
  set deleted_at = now(), refresh_locked_until = null
  where id = p_integration and org_id = p_org and deleted_at is null;
  v_found := found;
  if not v_found then
    return false;
  end if;

  delete from public.integration_secrets where integration_id = p_integration;

  update public.posts
  set state = 'error', locked_until = null,
      error = 'Le canal a été déconnecté avant la publication.'
  where integration_id = p_integration and state = 'queued' and deleted_at is null;

  return true;
end;
$$;

-- ---------------------------------------------------------------- rafraîchissement des jetons (worker)
-- Réclame les canaux dont le jeton expire bientôt ET qui ont un refresh token. Le verrou évite que deux workers
-- rafraîchissent le même jeton (les refresh tokens de X et TikTok sont à usage unique ou tournants).
create function public.claim_token_refresh(p_providers public.social_provider[], p_within_seconds int default 1800, p_lock_seconds int default 300, p_limit int default 20)
returns table (id uuid, org_id uuid, provider public.social_provider, name text, internal_id text, settings jsonb, refresh_token_enc text)
language sql security definer set search_path = public as $$
  with picked as (
    select i.id
    from public.integrations i
    join public.integration_secrets s on s.integration_id = i.id
    where i.status = 'active'
      and i.deleted_at is null
      and i.provider = any (p_providers)
      and i.token_expires_at is not null
      and i.token_expires_at < now() + make_interval(secs => p_within_seconds)
      and (i.refresh_locked_until is null or i.refresh_locked_until < now())
      and s.refresh_token_enc is not null
    order by i.token_expires_at
    limit p_limit
    for update of i skip locked
  ),
  locked as (
    update public.integrations i
    set refresh_locked_until = now() + make_interval(secs => p_lock_seconds)
    from picked where i.id = picked.id
    returning i.id, i.org_id, i.provider, i.name, i.internal_id, i.settings
  )
  select l.id, l.org_id, l.provider, l.name, l.internal_id, l.settings, s.refresh_token_enc
  from locked l join public.integration_secrets s on s.integration_id = l.id;
$$;

-- Enregistre les nouveaux jetons. Un refresh token null signifie « inchangé ». Ne fait rien si le canal a été
-- supprimé entre-temps (on ne ressuscite jamais un jeton déconnecté).
create function public.complete_token_refresh(p_integration uuid, p_access_token_enc text, p_refresh_token_enc text, p_expires_at timestamptz)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.integration_secrets s
  set access_token_enc = p_access_token_enc,
      refresh_token_enc = coalesce(p_refresh_token_enc, s.refresh_token_enc)
  from public.integrations i
  where s.integration_id = p_integration and i.id = s.integration_id and i.deleted_at is null;
  if not found then
    return false;
  end if;
  update public.integrations
  set token_expires_at = p_expires_at, refresh_locked_until = null
  where id = p_integration;
  return true;
end;
$$;

-- Échec définitif (refresh token refusé) : le canal passe à « reconnexion nécessaire ».
-- Échec passager : on ne touche à rien, le verrou expire et le worker réessaiera.
create function public.fail_token_refresh(p_integration uuid, p_permanent boolean) returns void
language sql security definer set search_path = public as $$
  update public.integrations
  set status = case when p_permanent then 'refresh_needed'::public.integration_status else status end,
      refresh_locked_until = case when p_permanent then null else refresh_locked_until end
  where id = p_integration and deleted_at is null and status = 'active';
$$;

-- Jetons expirés sans refresh token possible (ex. LinkedIn standard, ~60 jours) : reconnexion nécessaire.
create function public.expire_unrefreshable_integrations() returns table (id uuid, org_id uuid, provider public.social_provider, name text)
language sql security definer set search_path = public as $$
  update public.integrations i
  set status = 'refresh_needed'
  where i.status = 'active'
    and i.deleted_at is null
    and i.token_expires_at is not null
    and i.token_expires_at <= now()
    and not exists (select 1 from public.integration_secrets s where s.integration_id = i.id and s.refresh_token_enc is not null)
  returning i.id, i.org_id, i.provider, i.name;
$$;

-- Nettoyage des connexions abandonnées.
create function public.purge_expired_oauth() returns int
language plpgsql security definer set search_path = public as $$
declare
  a int;
  b int;
begin
  delete from public.oauth_states where expires_at < now();
  get diagnostics a = row_count;
  delete from public.oauth_pending_selections where expires_at < now();
  get diagnostics b = row_count;
  return a + b;
end;
$$;

-- ---------------------------------------------------------------- droits d'exécution : service_role uniquement
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('connect_integration', 'disconnect_integration', 'claim_token_refresh', 'complete_token_refresh',
                        'fail_token_refresh', 'expire_unrefreshable_integrations', 'purge_expired_oauth')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
