-- Postbiz : moteur (ingestion des messages, files de travail du worker, temps réel, stockage).
-- Les fonctions ci-dessous sont appelées par le service_role (worker, Edge Functions) uniquement.

-- ---------------------------------------------------------------- ingestion d'un message ou commentaire
-- Idempotente : un même message (conversation + external_id) n'est inséré qu'une fois.
create function public.ingest_message(
  p_integration_id uuid,
  p_kind public.conversation_kind,
  p_conversation_external_id text,
  p_contact_external_id text,
  p_contact_name text,
  p_contact_username text,
  p_contact_avatar_url text,
  p_message_external_id text,
  p_direction public.message_direction,
  p_body text,
  p_attachments jsonb,
  p_sent_at timestamptz,
  p_raw jsonb default null,
  p_target_external_id text default null
) returns table (o_conversation_id uuid, o_message_id uuid, o_inserted boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_contact uuid;
  v_conv uuid;
  v_msg uuid;
  v_at timestamptz := coalesce(p_sent_at, now());
  v_inbound boolean := (p_direction = 'in');
begin
  select i.org_id into v_org
  from public.integrations i
  where i.id = p_integration_id and i.deleted_at is null;
  if v_org is null then
    raise exception 'unknown integration %', p_integration_id using errcode = 'P0002';
  end if;

  insert into public.contacts (org_id, integration_id, platform_user_id, name, username, avatar_url)
  values (v_org, p_integration_id, p_contact_external_id, p_contact_name, p_contact_username, p_contact_avatar_url)
  on conflict (integration_id, platform_user_id) do update
    set name = coalesce(excluded.name, public.contacts.name),
        username = coalesce(excluded.username, public.contacts.username),
        avatar_url = coalesce(excluded.avatar_url, public.contacts.avatar_url)
  returning id into v_contact;

  insert into public.conversations (org_id, integration_id, contact_id, kind, external_id, target_external_id, last_message_at)
  values (v_org, p_integration_id, v_contact, p_kind, p_conversation_external_id, p_target_external_id, v_at)
  on conflict (integration_id, external_id) do nothing;

  select c.id into v_conv
  from public.conversations c
  where c.integration_id = p_integration_id and c.external_id = p_conversation_external_id;

  insert into public.messages (org_id, conversation_id, direction, external_id, body, attachments, delivery_status, raw, created_at)
  values (
    v_org, v_conv, p_direction, p_message_external_id, p_body, coalesce(p_attachments, '[]'::jsonb),
    case when v_inbound then 'received'::public.delivery_status else 'sent'::public.delivery_status end,
    p_raw, v_at
  )
  on conflict (conversation_id, external_id) where external_id is not null do nothing
  returning id into v_msg;

  if v_msg is null then
    -- doublon (webhook rejoué) : rien à mettre à jour
    select m.id into v_msg from public.messages m
    where m.conversation_id = v_conv and m.external_id = p_message_external_id;
    return query select v_conv, v_msg, false;
    return;
  end if;

  update public.conversations c set
    last_message_preview = case
      when v_at >= c.last_message_at then left(coalesce(nullif(p_body, ''), '[pièce jointe]'), 140)
      else c.last_message_preview end,
    last_message_at = greatest(c.last_message_at, v_at),
    unread_count = c.unread_count + (case when v_inbound then 1 else 0 end),
    last_inbound_at = case when v_inbound then greatest(coalesce(c.last_inbound_at, v_at), v_at) else c.last_inbound_at end,
    reply_window_expires_at = case
      when v_inbound and p_kind = 'dm' then greatest(coalesce(c.reply_window_expires_at, v_at + interval '24 hours'), v_at + interval '24 hours')
      else c.reply_window_expires_at end,
    status = case when v_inbound and c.status in ('closed', 'snoozed') then 'open'::public.conversation_status else c.status end,
    target_external_id = coalesce(c.target_external_id, p_target_external_id)
  where c.id = v_conv;

  return query select v_conv, v_msg, true;
end;
$$;

-- ---------------------------------------------------------------- messages sortants (file d'envoi)
create function public.claim_outbound_messages(p_limit int default 20, p_lock_seconds int default 120)
returns setof public.messages
language sql security definer set search_path = public as $$
  update public.messages m
  set delivery_status = 'sending',
      locked_until = now() + make_interval(secs => p_lock_seconds)
  where m.id in (
    select id from public.messages
    where direction = 'out' and delivery_status = 'queued'
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning m.*;
$$;

-- Le réseau a accepté le message. Si l'écho (webhook) est déjà arrivé, on fusionne au lieu de dupliquer.
create function public.complete_outbound_message(p_message_id uuid, p_external_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
  v_echo uuid;
  v_body text;
  v_sent_by uuid;
begin
  select m.conversation_id, m.body, m.sent_by into v_conv, v_body, v_sent_by
  from public.messages m where m.id = p_message_id;
  if v_conv is null then
    return;
  end if;

  select m.id into v_echo from public.messages m
  where m.conversation_id = v_conv and m.external_id = p_external_id and m.id <> p_message_id;

  if v_echo is not null then
    update public.messages set sent_by = coalesce(sent_by, v_sent_by) where id = v_echo;
    delete from public.messages where id = p_message_id;
  else
    update public.messages
    set external_id = p_external_id, delivery_status = 'sent', locked_until = null, error = null
    where id = p_message_id;
  end if;

  update public.conversations c set
    last_message_at = greatest(c.last_message_at, now()),
    last_message_preview = left(coalesce(nullif(v_body, ''), '[pièce jointe]'), 140)
  where c.id = v_conv;
end;
$$;

create function public.fail_outbound_message(p_message_id uuid, p_error text)
returns void
language sql security definer set search_path = public as $$
  update public.messages
  set delivery_status = 'failed', error = left(p_error, 1000), locked_until = null
  where id = p_message_id and delivery_status in ('queued', 'sending');
$$;

-- ---------------------------------------------------------------- publications (file de publication)
-- Ne réclame que les posts racines (les fils sont publiés avec leur racine) et les canaux actifs.
create function public.claim_due_posts(p_limit int default 10, p_lock_seconds int default 1800)
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

-- Travail abandonné : on ne le rejoue JAMAIS automatiquement (risque de doublon chez le réseau).
-- Un post resté « publishing » devient « unknown », un message resté « sending » devient « failed ».
create function public.sweep_stale_work() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_posts int;
  v_messages int;
begin
  update public.posts
  set state = 'unknown', locked_until = null,
      error = 'Résultat inconnu : le worker ne s''est pas terminé. Vérifiez sur le réseau avant de republier.'
  where state = 'publishing' and locked_until < now();
  get diagnostics v_posts = row_count;

  update public.messages
  set delivery_status = 'failed', locked_until = null,
      error = 'Résultat inconnu : vérifiez sur le réseau avant de renvoyer.'
  where direction = 'out' and delivery_status = 'sending' and locked_until < now();
  get diagnostics v_messages = row_count;

  return jsonb_build_object('posts_unknown', v_posts, 'messages_failed', v_messages);
end;
$$;

-- ---------------------------------------------------------------- droits d'exécution
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('ingest_message', 'claim_outbound_messages', 'complete_outbound_message',
                        'fail_outbound_message', 'claim_due_posts', 'sweep_stale_work')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Les fonctions de contrôle d'accès ne servent qu'aux utilisateurs connectés.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_org_member', 'has_org_role', 'shares_org_with', 'is_org_member_of')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- temps réel
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.conversations, public.messages, public.notifications, public.posts;
  end if;
end;
$$;

-- ---------------------------------------------------------------- stockage (présent seulement sur Supabase)
-- Convention de chemin : {org_id}/{fichier}
do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('media', 'media', false, 1073741824)
    on conflict (id) do nothing;

    execute $p$
      create policy media_objects_select on storage.objects for select to authenticated
      using (bucket_id = 'media' and public.is_org_member(((storage.foldername(name))[1])::uuid))
    $p$;
    execute $p$
      create policy media_objects_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'media'
        and public.has_org_role(((storage.foldername(name))[1])::uuid, array['admin','member']::public.org_role[]))
    $p$;
    execute $p$
      create policy media_objects_delete on storage.objects for delete to authenticated
      using (bucket_id = 'media'
        and public.has_org_role(((storage.foldername(name))[1])::uuid, array['admin','member']::public.org_role[]))
    $p$;
  end if;
end;
$$;
