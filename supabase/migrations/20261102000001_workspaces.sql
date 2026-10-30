-- Postbiz : espaces de travail (workspaces).
--
-- Un espace de travail EST une organisation : une personne peut être membre de plusieurs, et l'application lui fait choisir l'espace courant.
-- Rien ne change dans les tables de données (elles portent déjà `org_id` et la RLS). Cette migration ajoute ce qu'il faut pour en gérer plusieurs :
--   1. un seul essai gratuit par personne (`user_trials`) : un nouvel espace n'offre pas un nouvel essai de 14 jours ;
--   2. `create_organization` encadré (nom nettoyé, administrateur, 10 espaces au plus, reprise facultative des membres d'un autre espace) ;
--   3. le dernier administrateur d'un espace ne peut ni partir ni être rétrogradé ;
--   4. des invitations par adresse e-mail (lien à usage unique, jeton stocké haché) ;
--   5. la liste des membres avec leurs adresses (aux administrateurs) et la suppression d'un espace.

-- ---------------------------------------------------------------- 1. un essai par personne
-- L'essai est une propriété de la personne, pas de l'espace : sa date de début ne bouge plus, même si elle supprime son premier espace.
create table public.user_trials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.user_trials enable row level security;
revoke all on public.user_trials from anon, authenticated;

-- Les personnes qui ont déjà eu un essai (leurs organisations créées depuis le lancement de l'essai) : on garde sa date de début.
-- Les organisations de la bêta, sans abonnement, n'en donnent pas : leur créateur aura son essai à sa prochaine création.
insert into public.user_trials (user_id, started_at)
select o.created_by, min(s.created_at)
from public.organizations o
join public.subscriptions s on s.org_id = o.id
where o.created_by is not null
group by o.created_by
on conflict (user_id) do nothing;

-- Premier espace d'une personne : essai de 14 jours à partir de maintenant. Espaces suivants : même date de fin (si elle est passée, l'espace
-- apparaît « essai terminé »). Une organisation sans créateur (insérée par le service_role ou l'éditeur SQL) a l'essai habituel.
create or replace function public.start_trial() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_started timestamptz := now();
begin
  if new.created_by is not null then
    insert into public.user_trials (user_id) values (new.created_by) on conflict (user_id) do nothing;
    select t.started_at into v_started from public.user_trials t where t.user_id = new.created_by;
  end if;
  insert into public.subscriptions (org_id, plan, status, trial_ends_at)
  values (new.id, 'pro', 'trialing', v_started + interval '14 days')
  on conflict (org_id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------- 2. création d'un espace
-- La signature gagne un paramètre facultatif : l'application mobile, qui appelle `create_organization(p_name)`, continue de marcher.
drop function public.create_organization(text);

-- Règles (appliquées ici, pas seulement dans l'interface : l'API est appelable directement) :
--  - le nom est nettoyé (espaces simples) et limité à 120 caractères ;
--  - un compte suspendu ne crée rien ;
--  - il faut être administrateur d'au moins un espace (ou n'en avoir aucun) ;
--  - 10 espaces créés au plus par personne (supprimer un espace libère une place) ;
--  - `p_copy_members_from` (un espace dont l'appelant est administrateur) : ses membres rejoignent le nouvel espace avec le même rôle.
create function public.create_organization(p_name text, p_copy_members_from uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 120);
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.user_is_suspended(v_user) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  -- Même verrou que ensure_organization : deux créations simultanées ne dépassent pas le plafond.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  if exists (select 1 from public.memberships m where m.user_id = v_user)
     and not exists (select 1 from public.memberships m where m.user_id = v_user and m.role = 'admin') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if (select count(*) from public.organizations o where o.created_by = v_user) >= 10 then
    raise exception 'workspace_limit' using errcode = '23514';
  end if;
  if p_copy_members_from is not null and not public.has_org_role(p_copy_members_from, array['admin']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.organizations (name, created_by) values (v_name, v_user) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'admin');
  if p_copy_members_from is not null then
    insert into public.memberships (org_id, user_id, role)
    select v_org, m.user_id, m.role from public.memberships m where m.org_id = p_copy_members_from and m.user_id <> v_user
    on conflict (org_id, user_id) do nothing;
  end if;
  return v_org;
end;
$$;
revoke execute on function public.create_organization(text, uuid) from public, anon;
grant execute on function public.create_organization(text, uuid) to authenticated;

-- ---------------------------------------------------------------- 3. le dernier administrateur
-- Aucune règle ne l'imposait : un administrateur pouvait se retirer ou se rétrograder et laisser l'espace sans responsable.
-- La suppression de l'espace lui-même et celle du compte (cascades) passent.
create function public.memberships_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin'
     and not (tg_op = 'UPDATE' and new.role = 'admin')
     and exists (select 1 from public.organizations o where o.id = old.org_id)
     and exists (select 1 from auth.users u where u.id = old.user_id)
     and not exists (
       select 1 from public.memberships m where m.org_id = old.org_id and m.role = 'admin' and m.user_id <> old.user_id
     ) then
    raise exception 'last_admin' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger memberships_keep_admin before update of role or delete on public.memberships
  for each row execute function public.memberships_keep_admin();

-- ---------------------------------------------------------------- 4. invitations
-- Une invitation par (espace, adresse) : inviter de nouveau la même adresse remplace le lien précédent. Le jeton n'est jamais stocké en clair
-- (empreinte SHA-256) : il n'est montré qu'une fois, à l'administrateur qui invite. La réponse de `invite_to_workspace` est la même que l'adresse
-- ait déjà un compte ou non : on ne peut pas s'en servir pour savoir qui est inscrit.
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  role public.org_role not null default 'member',
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (org_id, email)
);
create index workspace_invitations_email_idx on public.workspace_invitations (email);

alter table public.workspace_invitations enable row level security;
create policy workspace_invitations_select on public.workspace_invitations for select to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));
create policy workspace_invitations_delete on public.workspace_invitations for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));
-- Écriture par les fonctions ci-dessous seulement ; l'empreinte du jeton n'est pas lisible par un client.
revoke all on public.workspace_invitations from anon, authenticated;
grant select (id, org_id, email, role, invited_by, created_at, expires_at) on public.workspace_invitations to authenticated;
grant delete on public.workspace_invitations to authenticated;

-- Empreinte d'un jeton d'invitation.
create function public.invitation_token_hash(p_token text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;
revoke execute on function public.invitation_token_hash(text) from public, anon, authenticated;

-- Invite une adresse dans l'espace (administrateurs seulement) et renvoie le jeton du lien, valable 7 jours.
create function public.invite_to_workspace(p_org uuid, p_email text, p_role public.org_role default 'member') returns text
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.org_id = p_org and lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  if (select count(*) from public.workspace_invitations i where i.org_id = p_org and i.email <> v_email) >= 50 then
    raise exception 'invitation_limit' using errcode = '23514';
  end if;

  -- Deux UUID v4 (générateur cryptographique) : 64 caractères hexadécimaux, sans dépendre de pgcrypto.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.workspace_invitations (org_id, email, role, token_hash, invited_by, expires_at)
  values (p_org, v_email, p_role, public.invitation_token_hash(v_token), v_user, now() + interval '7 days')
  on conflict (org_id, email) do update
    set role = excluded.role, token_hash = excluded.token_hash, invited_by = excluded.invited_by,
        created_at = now(), expires_at = excluded.expires_at;
  return v_token;
end;
$$;

-- Ce que montre la page du lien : l'espace, le rôle proposé, qui invite, et si l'on en est déjà membre. Rien si le jeton est inconnu ou périmé.
create function public.invitation_preview(p_token text)
returns table (org_id uuid, org_name text, role public.org_role, inviter_name text, expires_at timestamptz, already_member boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.user_is_suspended(auth.uid()) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  return query
  select i.org_id, o.name, i.role, p.display_name, i.expires_at,
         exists (select 1 from public.memberships m where m.org_id = i.org_id and m.user_id = auth.uid())
  from public.workspace_invitations i
  join public.organizations o on o.id = i.org_id
  left join public.profiles p on p.id = i.invited_by
  where i.token_hash = public.invitation_token_hash(p_token) and i.expires_at > now();
end;
$$;

-- Accepte l'invitation du lien : l'appelant devient membre avec le rôle proposé (jamais rétrogradé s'il l'est déjà). Le lien ne sert qu'une fois.
create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  inv public.workspace_invitations;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.user_is_suspended(v_user) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  select * into inv from public.workspace_invitations i
  where i.token_hash = public.invitation_token_hash(p_token) and i.expires_at > now()
  for update;
  if not found then
    raise exception 'invitation_invalid' using errcode = '22023';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, v_user, inv.role)
  on conflict (org_id, user_id) do nothing;
  delete from public.workspace_invitations where id = inv.id;
  return inv.org_id;
end;
$$;

-- Invitations reçues : celles qui portent l'adresse (confirmée) du compte. Le lien n'est pas nécessaire pour les retrouver.
create function public.my_invitations()
returns table (id uuid, org_id uuid, org_name text, role public.org_role, inviter_name text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.user_is_suspended(auth.uid()) then
    return;
  end if;
  return query
  select i.id, i.org_id, o.name, i.role, p.display_name, i.expires_at
  from public.workspace_invitations i
  join auth.users u on u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = i.email
  join public.organizations o on o.id = i.org_id
  left join public.profiles p on p.id = i.invited_by
  where i.expires_at > now()
  order by i.created_at desc, i.id;
end;
$$;

create function public.accept_invitation_by_id(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  inv public.workspace_invitations;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.user_is_suspended(v_user) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  select i.* into inv from public.workspace_invitations i
  join auth.users u on u.id = v_user and u.email_confirmed_at is not null and lower(u.email) = i.email
  where i.id = p_id and i.expires_at > now()
  for update of i;
  if not found then
    raise exception 'invitation_invalid' using errcode = '22023';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, v_user, inv.role)
  on conflict (org_id, user_id) do nothing;
  delete from public.workspace_invitations where id = inv.id;
  return inv.org_id;
end;
$$;

create function public.decline_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.workspace_invitations i
  using auth.users u
  where i.id = p_id and u.id = v_user and u.email_confirmed_at is not null and lower(u.email) = i.email;
end;
$$;

-- ---------------------------------------------------------------- 5. membres et suppression
-- Les membres d'un espace. L'adresse n'est donnée qu'aux administrateurs : un membre ordinaire ne voit que des noms, comme avant.
create function public.workspace_members(p_org uuid)
returns table (user_id uuid, name text, email text, role public.org_role, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_admin boolean;
begin
  if not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_admin := public.has_org_role(p_org, array['admin']::public.org_role[]);
  return query
  select m.user_id, coalesce(p.display_name, ''), case when v_admin then u.email::text end, m.role, m.created_at
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.org_id = p_org
  order by m.created_at, m.user_id;
end;
$$;

-- Supprime un espace et tout ce qu'il contient (cascades). Garde-fous : administrateur seulement ; il reste un autre espace à l'appelant ;
-- plus de canal connecté (les jetons et abonnements chez les réseaux se retirent par « Déconnecter ») ; aucune publication en file.
-- Les fichiers du stockage (dossier « <espace>/ ») ne font pas partie des tables : l'application les retire ensuite.
create function public.delete_workspace(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships m where m.user_id = v_user and m.org_id <> p_org) then
    raise exception 'last_workspace' using errcode = '23514';
  end if;
  if exists (select 1 from public.integrations i where i.org_id = p_org and i.deleted_at is null) then
    raise exception 'has_channels' using errcode = '23514';
  end if;
  if exists (select 1 from public.posts p where p.org_id = p_org and p.deleted_at is null and p.state in ('queued', 'publishing')) then
    raise exception 'has_queued_posts' using errcode = '23514';
  end if;
  delete from public.organizations where id = p_org;
end;
$$;

revoke execute on function public.invite_to_workspace(uuid, text, public.org_role) from public, anon;
revoke execute on function public.invitation_preview(text) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
revoke execute on function public.my_invitations() from public, anon;
revoke execute on function public.accept_invitation_by_id(uuid) from public, anon;
revoke execute on function public.decline_invitation(uuid) from public, anon;
revoke execute on function public.workspace_members(uuid) from public, anon;
revoke execute on function public.delete_workspace(uuid) from public, anon;
grant execute on function public.invite_to_workspace(uuid, text, public.org_role) to authenticated;
grant execute on function public.invitation_preview(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.my_invitations() to authenticated;
grant execute on function public.accept_invitation_by_id(uuid) to authenticated;
grant execute on function public.decline_invitation(uuid) to authenticated;
grant execute on function public.workspace_members(uuid) to authenticated;
grant execute on function public.delete_workspace(uuid) to authenticated;
