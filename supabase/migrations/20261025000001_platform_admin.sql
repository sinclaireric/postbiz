-- Postbiz : espace propriétaire (super admin), abonnements et essais.
--
-- Le propriétaire du SaaS n'est membre d'aucune organisation cliente : il est déclaré dans `platform_admins` (à la main, dans
-- l'éditeur SQL de Supabase, voir docs/ADMIN.md). Les fonctions `admin_*` sont les seules à lire à travers les organisations ;
-- chacune vérifie elle-même `is_platform_admin()`, de sorte qu'un appel direct à l'API par un autre utilisateur est refusé.

-- ---------------------------------------------------------------- administrateurs de la plateforme
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
-- Aucune policy et aucun droit : seul le service_role (ou l'éditeur SQL) la lit et l'écrit.
revoke all on public.platform_admins from anon, authenticated;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- ---------------------------------------------------------------- abonnements
-- Une ligne par organisation. Les statuts reprennent ceux de Stripe pour que le futur webhook n'ait qu'à les recopier.
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled');
create type public.billing_interval as enum ('monthly', 'yearly');

create table public.subscriptions (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  plan text not null default 'pro' check (plan in ('starter', 'pro', 'team')),
  status public.subscription_status not null default 'trialing',
  billing_interval public.billing_interval not null default 'monthly',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_trial_has_end check (status <> 'trialing' or trial_ends_at is not null)
);
create index subscriptions_status_idx on public.subscriptions (status, trial_ends_at);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
create policy subscriptions_select on public.subscriptions for select to authenticated using (public.is_org_member(org_id));
-- Écriture réservée au service_role (webhook de paiement, éditeur SQL) : un client ne peut pas s'accorder un abonnement.
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- Essai gratuit de 14 jours sur l'offre Pro pour toute nouvelle organisation. Les organisations qui existaient déjà (bêta gratuite)
-- n'ont pas d'abonnement : l'espace propriétaire les compte à part, sans leur inventer d'essai.
create function public.start_trial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (org_id, plan, status, trial_ends_at)
  values (new.id, 'pro', 'trialing', now() + interval '14 days')
  on conflict (org_id) do nothing;
  return new;
end;
$$;
create trigger organizations_start_trial after insert on public.organizations
  for each row execute function public.start_trial();

-- Phase commerciale d'une organisation : 'none' (pas d'abonnement), 'trialing' (essai en cours), 'trial_expired' (essai terminé
-- sans abonnement), 'paying', 'past_due' ou 'canceled'.
create function public.subscription_phase(p_status public.subscription_status, p_trial_ends_at timestamptz) returns text
language sql stable set search_path = public as $$
  select case
    when p_status is null then 'none'
    when p_status = 'trialing' and p_trial_ends_at > now() then 'trialing'
    when p_status = 'trialing' then 'trial_expired'
    when p_status = 'active' then 'paying'
    else p_status::text
  end;
$$;
revoke execute on function public.subscription_phase(public.subscription_status, timestamptz) from public, anon;
grant execute on function public.subscription_phase(public.subscription_status, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------- tableau de bord
create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
      'new_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
      'active_7d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
      'unconfirmed', (select count(*) from auth.users where email_confirmed_at is null)
    ),
    'orgs', jsonb_build_object(
      'total', (select count(*) from public.organizations),
      'with_channel', (select count(distinct org_id) from public.integrations where deleted_at is null),
      'with_published', (select count(distinct org_id) from public.posts where state = 'published' and deleted_at is null)
    ),
    'phases', (
      select coalesce(jsonb_object_agg(phase, n), '{}'::jsonb)
      from (
        select public.subscription_phase(s.status, s.trial_ends_at) as phase, count(*) as n
        from public.organizations o left join public.subscriptions s on s.org_id = o.id
        group by 1
      ) x
    ),
    'trials_ending_3d', (
      select count(*) from public.subscriptions
      where status = 'trialing' and trial_ends_at > now() and trial_ends_at <= now() + interval '3 days'
    ),
    'cancel_at_period_end', (
      select count(*) from public.subscriptions where status = 'active' and cancel_at_period_end
    ),
    -- Organisations par offre, rythme de facturation et statut : le prix vient de l'application (lib/pricing.ts), pas d'ici.
    'by_plan', (
      select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'interval', billing_interval, 'phase', phase, 'count', n)), '[]'::jsonb)
      from (
        select plan, billing_interval, public.subscription_phase(status, trial_ends_at) as phase, count(*) as n
        from public.subscriptions
        group by 1, 2, 3
      ) x
    ),
    'channels', jsonb_build_object(
      'total', (select count(*) from public.integrations where deleted_at is null),
      'needs_reconnect', (select count(*) from public.integrations where deleted_at is null and status = 'refresh_needed'),
      'by_provider', (
        select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb)
        from (select provider, count(*) as n from public.integrations where deleted_at is null group by 1) x
      )
    ),
    'posts', jsonb_build_object(
      'created_7d', (select count(*) from public.posts where deleted_at is null and created_at >= now() - interval '7 days'),
      'by_state', (
        select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
        from (select state, count(*) as n from public.posts where deleted_at is null group by 1) x
      )
    ),
    'signups', (
      select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'count', c) order by d), '[]'::jsonb)
      from (
        select g::date as d,
               (select count(*) from auth.users u where u.created_at >= g and u.created_at < g + interval '1 day') as c
        from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') g
      ) s
    )
  ) into v;
  return v;
end;
$$;

-- Texte libre du filtre de recherche → motif LIKE : % _ et \ perdent leur sens spécial.
create function public.admin_like_pattern(p_search text) returns text
language sql immutable as $$
  select case
    when nullif(btrim(p_search), '') is null then null
    else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
$$;
revoke execute on function public.admin_like_pattern(text) from public, anon;

-- Liste des utilisateurs avec leur organisation (la plus ancienne) et son abonnement.
-- p_phase : 'none' | 'trialing' | 'trial_expired' | 'paying' | 'past_due' | 'canceled' | null (tous).
create function public.admin_users(
  p_search text default null, p_phase text default null, p_limit int default 25, p_offset int default 0
) returns table (
  user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean,
  org_id uuid, org_name text, role public.org_role, orgs_count int,
  plan text, status public.subscription_status, billing_interval public.billing_interval, phase text,
  trial_ends_at timestamptz, current_period_end timestamptz, cancel_at_period_end boolean,
  channels_count int, posts_count int, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_pattern text := public.admin_like_pattern(p_search);
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      u.id as user_id, u.email::text as email, p.display_name, u.created_at, u.last_sign_in_at,
      (u.email_confirmed_at is not null) as email_confirmed,
      m.org_id, o.name as org_name, m.role,
      (select count(*)::int from public.memberships x where x.user_id = u.id) as orgs_count,
      s.plan, s.status, s.billing_interval, public.subscription_phase(s.status, s.trial_ends_at) as phase,
      s.trial_ends_at, s.current_period_end, coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
      (select count(*)::int from public.integrations i where i.org_id = m.org_id and i.deleted_at is null) as channels_count,
      (select count(*)::int from public.posts po where po.org_id = m.org_id and po.deleted_at is null) as posts_count
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join lateral (
      select mm.org_id, mm.role from public.memberships mm where mm.user_id = u.id order by mm.created_at, mm.org_id limit 1
    ) m on true
    left join public.organizations o on o.id = m.org_id
    left join public.subscriptions s on s.org_id = m.org_id
  )
  select b.*, count(*) over () as total_count
  from base b
  where (v_pattern is null or b.email ilike v_pattern escape '\' or b.display_name ilike v_pattern escape '\' or b.org_name ilike v_pattern escape '\')
    and (p_phase is null or b.phase = p_phase)
  order by b.created_at desc, b.user_id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Liste des organisations avec leur abonnement (même filtre de phase).
create function public.admin_organizations(
  p_search text default null, p_phase text default null, p_limit int default 25, p_offset int default 0
) returns table (
  org_id uuid, org_name text, created_at timestamptz, owner_email text, members_count int, channels_count int, posts_count int,
  plan text, status public.subscription_status, billing_interval public.billing_interval, phase text,
  trial_ends_at timestamptz, current_period_end timestamptz, cancel_at_period_end boolean, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_pattern text := public.admin_like_pattern(p_search);
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      o.id as org_id, o.name as org_name, o.created_at,
      (select u.email::text from auth.users u where u.id = coalesce(
         o.created_by,
         (select mm.user_id from public.memberships mm where mm.org_id = o.id and mm.role = 'admin' order by mm.created_at limit 1)
       )) as owner_email,
      (select count(*)::int from public.memberships mm where mm.org_id = o.id) as members_count,
      (select count(*)::int from public.integrations i where i.org_id = o.id and i.deleted_at is null) as channels_count,
      (select count(*)::int from public.posts po where po.org_id = o.id and po.deleted_at is null) as posts_count,
      s.plan, s.status, s.billing_interval, public.subscription_phase(s.status, s.trial_ends_at) as phase,
      s.trial_ends_at, s.current_period_end, coalesce(s.cancel_at_period_end, false) as cancel_at_period_end
    from public.organizations o
    left join public.subscriptions s on s.org_id = o.id
  )
  select b.*, count(*) over () as total_count
  from base b
  where (v_pattern is null or b.org_name ilike v_pattern escape '\' or b.owner_email ilike v_pattern escape '\')
    and (p_phase is null or b.phase = p_phase)
  order by b.created_at desc, b.org_id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_users(text, text, int, int) from public, anon;
revoke execute on function public.admin_organizations(text, text, int, int) from public, anon;
grant execute on function public.admin_overview() to authenticated, service_role;
grant execute on function public.admin_users(text, text, int, int) to authenticated, service_role;
grant execute on function public.admin_organizations(text, text, int, int) to authenticated, service_role;
