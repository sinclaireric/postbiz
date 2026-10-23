-- Postbiz : fiche détaillée d'un utilisateur pour l'espace propriétaire.
--
-- Ne renvoie que des métadonnées et des chiffres : jamais le texte des publications ni des messages, ni les jetons des canaux.

create function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'display_name', p.display_name,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'email_confirmed_at', u.email_confirmed_at,
      'provider', coalesce(u.raw_app_meta_data ->> 'provider', 'email')
    ),
    'orgs', coalesce((
      select jsonb_agg(x.org order by x.joined_at, x.org_id)
      from (
        select
          m.created_at as joined_at,
          o.id as org_id,
          jsonb_build_object(
            'org_id', o.id,
            'name', o.name,
            'created_at', o.created_at,
            'role', m.role,
            'members_count', (select count(*) from public.memberships mm where mm.org_id = o.id),
            'subscription', case when s.org_id is null then null else jsonb_build_object(
              'plan', s.plan,
              'status', s.status,
              'billing_interval', s.billing_interval,
              'phase', public.subscription_phase(s.status, s.trial_ends_at),
              'trial_ends_at', s.trial_ends_at,
              'current_period_end', s.current_period_end,
              'cancel_at_period_end', s.cancel_at_period_end,
              'canceled_at', s.canceled_at,
              'stripe_customer_id', s.stripe_customer_id,
              'stripe_subscription_id', s.stripe_subscription_id,
              'created_at', s.created_at
            ) end,
            'channels', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', i.id, 'provider', i.provider, 'name', i.name, 'username', i.username,
                'status', i.status, 'created_at', i.created_at, 'token_expires_at', i.token_expires_at
              ) order by i.created_at, i.id)
              from public.integrations i where i.org_id = o.id and i.deleted_at is null
            ), '[]'::jsonb),
            'posts', jsonb_build_object(
              'by_state', coalesce((
                select jsonb_object_agg(st.state, st.n)
                from (select state, count(*) as n from public.posts po where po.org_id = o.id and po.deleted_at is null group by 1) st
              ), '{}'::jsonb),
              'last_published_at', (
                select max(po.publish_at) from public.posts po where po.org_id = o.id and po.deleted_at is null and po.state = 'published'
              ),
              'last_created_at', (
                select max(po.created_at) from public.posts po where po.org_id = o.id and po.deleted_at is null
              )
            )
          ) as org
        from public.memberships m
        join public.organizations o on o.id = m.org_id
        left join public.subscriptions s on s.org_id = o.id
        where m.user_id = u.id
      ) x
    ), '[]'::jsonb)
  ) into v
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user;

  return v; -- null si l'utilisateur n'existe pas
end;
$$;

revoke execute on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated, service_role;
