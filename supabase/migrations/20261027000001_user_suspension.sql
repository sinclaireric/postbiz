-- Postbiz : suspension d'un utilisateur par le propriétaire de la plateforme.
--
-- Une suspension fait quatre choses :
--   1. la connexion est refusée (auth.users.banned_until, vérifié par Supabase Auth à la connexion et au renouvellement du jeton) ;
--   2. ses sessions sont fermées tout de suite ;
--   3. les politiques d'accès (RLS) ne lui donnent plus accès à aucune organisation, même avec un jeton encore valide ;
--   4. le worker n'envoie plus ses publications, ses premiers commentaires ni ses réponses.
-- Ses données sont conservées ; le rétablissement remet tout en l'état.

create table public.user_suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  suspended_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 500),
  suspended_by uuid references auth.users (id) on delete set null
);
alter table public.user_suspensions enable row level security;
-- Aucune policy et aucun droit : ni le suspendu ni personne d'autre ne la lit par l'API (seules les fonctions ci-dessous y touchent).
revoke all on public.user_suspensions from anon, authenticated;

-- Interne : appelée par des fonctions SECURITY DEFINER (policies, file d'envoi). Fermée aux clients, qui pourraient sinon tester
-- l'état de n'importe quel utilisateur.
create function public.user_is_suspended(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_suspensions where user_id = p_user);
$$;
revoke execute on function public.user_is_suspended(uuid) from public, anon, authenticated;
grant execute on function public.user_is_suspended(uuid) to service_role;

-- Pour l'application : « mon compte est-il suspendu ? »
create function public.is_suspended() returns boolean
language sql stable security definer set search_path = public as $$
  select public.user_is_suspended(auth.uid());
$$;
revoke execute on function public.is_suspended() from public, anon;
grant execute on function public.is_suspended() to authenticated, service_role;

-- ---------------------------------------------------------------- accès aux données
-- Toutes les policies passent par ces trois fonctions : un utilisateur suspendu n'est membre de rien.
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid()
  ) and not public.user_is_suspended(auth.uid());
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  ) and not public.user_is_suspended(auth.uid());
$$;

create or replace function public.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on b.org_id = a.org_id
    where a.user_id = auth.uid() and b.user_id = p_user
  ) and not public.user_is_suspended(auth.uid());
$$;

-- Un compte suspendu sans organisation n'en crée pas une à sa prochaine visite.
create or replace function public.ensure_organization(p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_name text := left(coalesce(nullif(btrim(p_name), ''), 'Mon espace'), 120);
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.user_is_suspended(v_user) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select m.org_id into v_org
  from public.memberships m
  where m.user_id = v_user
  order by m.created_at, m.org_id
  limit 1;
  if v_org is not null then
    return v_org;
  end if;

  insert into public.organizations (name, created_by) values (v_name, v_user) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'admin');
  return v_org;
end;
$$;

-- ---------------------------------------------------------------- envois du worker
-- Les publications restent en file (« queued ») : au rétablissement, celles dont l'heure est passée partent aussitôt.
create or replace function public.claim_due_posts(p_limit int default 10, p_lock_seconds int default 1800)
returns setof public.posts
language sql security definer set search_path = public as $$
  update public.posts p
  set state = 'publishing',
      attempts = p.attempts + 1,
      locked_until = now() + make_interval(secs => p_lock_seconds),
      error = null
  where p.id in (
    select q.id from public.posts q
    where q.state = 'queued'
      and q.publish_at <= now()
      and q.deleted_at is null
      and q.parent_post_id is null
      and not public.user_is_suspended(q.created_by)
      and exists (
        select 1 from public.integrations i
        where i.id = q.integration_id and i.status = 'active' and i.deleted_at is null
      )
    order by q.publish_at
    limit p_limit
    for update of q skip locked
  )
  returning p.*;
$$;

create or replace function public.claim_first_comments(p_limit int default 10, p_lock_seconds int default 300)
returns setof public.posts
language sql security definer set search_path = public as $$
  update public.posts p
  set first_comment_state = 'posting',
      first_comment_error = null,
      locked_until = now() + make_interval(secs => p_lock_seconds)
  where p.id in (
    select q.id from public.posts q
    where q.state = 'published'
      and q.first_comment_state = 'pending'
      and q.deleted_at is null
      and q.parent_post_id is null
      and not public.user_is_suspended(q.created_by)
    order by q.publish_at nulls last, q.created_at
    limit p_limit
    for update of q skip locked
  )
  returning p.*;
$$;

create or replace function public.claim_outbound_messages(p_limit int default 20, p_lock_seconds int default 120)
returns setof public.messages
language sql security definer set search_path = public as $$
  update public.messages m
  set delivery_status = 'sending',
      locked_until = now() + make_interval(secs => p_lock_seconds)
  where m.id in (
    select id from public.messages
    where direction = 'out' and delivery_status = 'queued'
      and not public.user_is_suspended(sent_by)
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning m.*;
$$;

-- ---------------------------------------------------------------- actions du propriétaire
create function public.admin_suspend_user(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'cannot suspend yourself' using errcode = '22023';
  end if;
  if exists (select 1 from public.platform_admins where user_id = p_user) then
    raise exception 'cannot suspend a platform admin' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  -- Déjà suspendu : on garde la date et le motif d'origine.
  insert into public.user_suspensions (user_id, reason, suspended_by)
  values (p_user, nullif(left(btrim(p_reason), 500), ''), auth.uid())
  on conflict (user_id) do nothing;

  update auth.users set banned_until = now() + interval '100 years' where id = p_user;
  delete from auth.sessions where user_id = p_user;
end;
$$;

create function public.admin_restore_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.user_suspensions where user_id = p_user;
  update auth.users set banned_until = null where id = p_user;
end;
$$;

-- État de suspension d'un utilisateur, pour sa fiche : { suspension: { at, reason, by_email } | null, is_platform_admin }.
create function public.admin_user_status(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'suspension', (
      select jsonb_build_object('at', s.suspended_at, 'reason', s.reason, 'by_email', (select u.email from auth.users u where u.id = s.suspended_by))
      from public.user_suspensions s where s.user_id = p_user
    ),
    'is_platform_admin', exists (select 1 from public.platform_admins where user_id = p_user)
  );
end;
$$;

-- La liste des utilisateurs indique ceux qui sont suspendus : nouvelle colonne, donc la fonction est recréée.
drop function public.admin_users(text, text, int, int);
create function public.admin_users(
  p_search text default null, p_phase text default null, p_limit int default 25, p_offset int default 0
) returns table (
  user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean,
  org_id uuid, org_name text, role public.org_role, orgs_count int,
  plan text, status public.subscription_status, billing_interval public.billing_interval, phase text,
  trial_ends_at timestamptz, current_period_end timestamptz, cancel_at_period_end boolean,
  channels_count int, posts_count int, suspended boolean, total_count bigint
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
      (select count(*)::int from public.posts po where po.org_id = m.org_id and po.deleted_at is null) as posts_count,
      exists (select 1 from public.user_suspensions us where us.user_id = u.id) as suspended
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

revoke execute on function public.admin_suspend_user(uuid, text) from public, anon;
revoke execute on function public.admin_restore_user(uuid) from public, anon;
revoke execute on function public.admin_user_status(uuid) from public, anon;
revoke execute on function public.admin_users(text, text, int, int) from public, anon;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated, service_role;
grant execute on function public.admin_restore_user(uuid) to authenticated, service_role;
grant execute on function public.admin_user_status(uuid) to authenticated, service_role;
grant execute on function public.admin_users(text, text, int, int) to authenticated, service_role;
