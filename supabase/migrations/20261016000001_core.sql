-- Postbiz : noyau multi-tenant (organisations, canaux, publications, médias).
-- Toutes les tables exposées à PostgREST ont la RLS activée.
-- Les écritures sensibles (canaux, jetons, états de publication) passent par le service_role.

-- ---------------------------------------------------------------- types
create type public.social_provider as enum ('facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'youtube');
create type public.org_role as enum ('admin', 'member', 'viewer');
create type public.integration_status as enum ('active', 'refresh_needed', 'disabled');
-- queued -> publishing -> published | error | unknown (résultat inconnu : jamais de rejeu automatique)
create type public.post_state as enum ('draft', 'queued', 'publishing', 'published', 'error', 'unknown');
create type public.media_status as enum ('uploaded', 'processing', 'ready', 'failed');

-- ---------------------------------------------------------------- utilitaires
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profils
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- organisations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Fonctions de contrôle d'accès. SECURITY DEFINER pour éviter la récursion de RLS sur memberships.
create function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create function public.has_org_role(p_org uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  );
$$;

create function public.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on b.org_id = a.org_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- Création d'une organisation : l'appelant en devient administrateur.
create function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.organizations (name, created_by) values (p_name, auth.uid()) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, auth.uid(), 'admin');
  return v_org;
end;
$$;

-- ---------------------------------------------------------------- canaux
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider public.social_provider not null,
  internal_id text not null,               -- identifiant du compte chez le réseau (page, compte pro, chaîne...)
  name text not null,
  username text,
  picture_url text,
  status public.integration_status not null default 'active',
  token_expires_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, provider, internal_id)
);
create index integrations_org_idx on public.integrations (org_id) where deleted_at is null;
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

-- Jetons chiffrés côté applicatif (AES-GCM). Table sans aucune policy : inaccessible aux clients.
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text,
  updated_at timestamptz not null default now()
);
create trigger integration_secrets_updated_at before update on public.integration_secrets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- médias
create table public.media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bucket text not null default 'media',
  path text not null,
  mime_type text,
  size_bytes bigint,
  width int,
  height int,
  duration_seconds numeric,
  status public.media_status not null default 'uploaded',
  normalized_path text,                    -- résultat de postbiz-uploader
  thumbnail_path text,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index media_org_idx on public.media (org_id, created_at desc);

-- ---------------------------------------------------------------- publications
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  group_id uuid not null default gen_random_uuid(),   -- un même contenu envoyé vers plusieurs canaux
  parent_post_id uuid references public.posts (id) on delete cascade, -- fil / thread
  position int not null default 0,
  content text not null default '',
  media jsonb not null default '[]'::jsonb,           -- [{media_id, path, type, alt}]
  settings jsonb not null default '{}'::jsonb,        -- réglages propres au réseau
  publish_at timestamptz,
  state public.post_state not null default 'draft',
  attempts int not null default 0,
  locked_until timestamptz,
  release_id text,                                    -- identifiant du post chez le réseau
  release_url text,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint posts_queued_needs_date check (state <> 'queued' or publish_at is not null)
);
create index posts_org_date_idx on public.posts (org_id, publish_at) where deleted_at is null;
create index posts_due_idx on public.posts (publish_at) where state = 'queued' and deleted_at is null;
create index posts_group_idx on public.posts (group_id);
create trigger posts_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.media enable row level security;
alter table public.posts enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;

-- profiles : le sien et ceux des membres de ses organisations
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations (création uniquement via create_organization)
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['admin']::public.org_role[]))
  with check (public.has_org_role(id, array['admin']::public.org_role[]));

-- memberships
create policy memberships_select on public.memberships for select to authenticated
  using (public.is_org_member(org_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]) or user_id = auth.uid());

-- integrations : lecture seule côté client (écritures par le service_role : callbacks OAuth, worker)
create policy integrations_select on public.integrations for select to authenticated
  using (public.is_org_member(org_id) and deleted_at is null);

-- integration_secrets : aucune policy => aucun accès client

-- media
create policy media_select on public.media for select to authenticated
  using (public.is_org_member(org_id));
create policy media_insert on public.media for insert to authenticated
  with check (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]) and created_by = auth.uid());
create policy media_delete on public.media for delete to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));

-- posts : un client ne peut créer/modifier que des brouillons ou des posts en file ;
-- publishing/published/error/unknown sont réservés au worker (service_role).
-- Pas de filtre deleted_at ici : une suppression logique (UPDATE ... deleted_at) échouerait, car Postgres
-- exige que la nouvelle ligne reste visible par la policy SELECT. Les requêtes filtrent `deleted_at is null`.
create policy posts_select on public.posts for select to authenticated
  using (public.is_org_member(org_id));
create policy posts_insert on public.posts for insert to authenticated
  with check (
    public.has_org_role(org_id, array['admin', 'member']::public.org_role[])
    and created_by = auth.uid()
    and state in ('draft', 'queued')
    and exists (select 1 from public.integrations i where i.id = integration_id and i.org_id = posts.org_id and i.deleted_at is null)
  );
create policy posts_update on public.posts for update to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]) and state in ('draft', 'queued', 'error', 'unknown'))
  with check (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]) and state in ('draft', 'queued'));
create policy posts_delete on public.posts for delete to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]) and state in ('draft', 'queued', 'error', 'unknown'));

-- notifications / push tokens : propres à l'utilisateur
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_tokens_all on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- privilèges (défense en profondeur)
revoke all on public.integration_secrets from anon, authenticated;
revoke insert, update, delete on public.integrations from anon, authenticated;
revoke insert, delete on public.organizations from anon, authenticated;
revoke all on public.profiles, public.organizations, public.memberships, public.integrations,
  public.media, public.posts, public.notifications, public.push_tokens from anon;
-- Colonnes modifiables par un client sur posts (pas d'écriture directe de l'état d'exécution)
revoke update on public.posts from authenticated;
grant update (content, media, settings, publish_at, state, position, deleted_at) on public.posts to authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
revoke update on public.memberships from authenticated;
grant update (role) on public.memberships to authenticated;

revoke execute on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;
