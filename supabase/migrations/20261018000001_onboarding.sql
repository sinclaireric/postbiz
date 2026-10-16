-- Postbiz : création automatique de l'organisation à la première connexion (comme Postiz : pas d'étape
-- « nommer votre organisation » avant l'onboarding).

-- Idempotente : si l'utilisateur appartient déjà à une organisation, renvoie la plus ancienne ; sinon en crée une
-- dont il est administrateur. Le verrou consultatif évite les doublons quand deux requêtes arrivent en même temps
-- (par exemple deux onglets ouverts juste après la confirmation de l'e-mail).
create function public.ensure_organization(p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_name text := left(coalesce(nullif(btrim(p_name), ''), 'Mon espace'), 120);
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
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

revoke execute on function public.ensure_organization(text) from public, anon;
grant execute on function public.ensure_organization(text) to authenticated;
