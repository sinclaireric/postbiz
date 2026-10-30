-- Postbiz : chat de support.
--
-- Une conversation par utilisateur (écrire au support depuis le site ou l'application mobile), des messages texte, et un état
-- ouvert / résolu. Le propriétaire de la plateforme répond depuis /admin/support.
--
-- Droits :
--   * un utilisateur LIT sa conversation et ses messages (RLS), et n'écrit que par `support_send` / `support_mark_read` (limite de débit,
--     taille, nettoyage du texte). Aucune écriture directe : le service_role seul garde les droits sur les tables ;
--   * le propriétaire passe par les fonctions `admin_support_*`, qui vérifient chacune `is_platform_admin()` (même modèle que `admin_*`).
--     Elles seules lisent la conversation d'un autre et renvoient l'adresse e-mail de l'auteur : aucun client ordinaire ne la voit.
--
-- Pièces jointes : pas dans cette version (texte seulement). Elles s'ajouteront par une migration à part (bucket privé, politique par chemin).

-- ---------------------------------------------------------------- tables
create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  -- L'espace de travail courant de la personne à son dernier message : un contexte pour le propriétaire, pas un droit d'accès.
  org_id uuid references public.organizations (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  -- Réponses du support que la personne n'a pas encore lues / messages de la personne que le support n'a pas encore lus.
  user_unread int not null default 0 check (user_unread >= 0),
  support_unread int not null default 0 check (support_unread >= 0),
  last_author text not null default 'user' check (last_author in ('user', 'support')),
  last_message_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint support_conversations_resolved_has_date check (status <> 'resolved' or resolved_at is not null)
);
create index support_conversations_activity_idx on public.support_conversations (last_message_at desc, id);
create index support_conversations_unread_idx on public.support_conversations (last_message_at desc) where support_unread > 0;

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations (id) on delete cascade,
  author text not null check (author in ('user', 'support')),
  body text not null check (char_length(body) between 1 and 4000),
  -- clock_timestamp : deux messages écrits dans la même transaction gardent leur ordre.
  created_at timestamptz not null default clock_timestamp()
);
create index support_messages_thread_idx on public.support_messages (conversation_id, created_at, id);

-- ---------------------------------------------------------------- RLS : l'utilisateur lit SA conversation, rien d'autre
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

create policy support_conversations_select on public.support_conversations for select to authenticated
  using (user_id = auth.uid() and not public.is_suspended());
create policy support_messages_select on public.support_messages for select to authenticated
  using (
    not public.is_suspended()
    and exists (select 1 from public.support_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );

-- Défense en profondeur : même sans policy d'écriture, aucun droit d'écriture pour un client.
revoke all on public.support_conversations, public.support_messages from anon, authenticated;
grant select on public.support_conversations, public.support_messages to authenticated;

-- ---------------------------------------------------------------- texte d'un message
-- Fins de ligne normalisées, caractères de contrôle retirés, et les marques de direction du texte (U+202A–202E, U+2066–2069) qui permettent
-- de faire passer un texte pour un autre à l'écran ; trois sauts de ligne ou plus ramenés à deux ; espaces de début et de fin retirés.
-- L'interface n'interprète jamais le texte (ni HTML, ni lien cliquable) : elle l'affiche tel quel.
create function public.support_clean_body(p_body text) returns text
language sql immutable set search_path = public as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p_body, ''), E'\r\n?', E'\n', 'g'),
        '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]', '', 'g'),
      E'\n{3,}', E'\n\n', 'g'),
    E' \n\t'
  );
$$;
revoke execute on function public.support_clean_body(text) from public, anon;
grant execute on function public.support_clean_body(text) to authenticated, service_role;

-- ---------------------------------------------------------------- côté utilisateur
-- Écrit au support : crée la conversation au premier message, la rouvre si elle était résolue, prévient le propriétaire.
-- Limites (modifiables par une nouvelle migration) : 2 000 caractères par message, 5 messages par minute, 20 messages sans réponse du support.
-- p_org : l'espace courant de la personne, retenu seulement si elle en est membre.
create function public.support_send(p_body text, p_org uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_body text := public.support_clean_body(p_body);
  v_org uuid;
  v_conv public.support_conversations;
  v_msg uuid;
  v_last_reply timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.user_is_suspended(v_user) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'message_too_long' using errcode = '22001';
  end if;

  if p_org is not null and exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = v_user) then
    v_org := p_org;
  end if;

  -- La ligne de conversation est verrouillée : deux envois simultanés de la même personne se suivent, la limite de débit tient.
  insert into public.support_conversations (user_id, org_id) values (v_user, v_org) on conflict (user_id) do nothing;
  select * into v_conv from public.support_conversations where user_id = v_user for update;

  if (select count(*) from public.support_messages
       where conversation_id = v_conv.id and author = 'user' and created_at > clock_timestamp() - interval '1 minute') >= 5 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;
  select max(created_at) into v_last_reply from public.support_messages where conversation_id = v_conv.id and author = 'support';
  if (select count(*) from public.support_messages
       where conversation_id = v_conv.id and author = 'user' and created_at > coalesce(v_last_reply, '-infinity'::timestamptz)) >= 20 then
    raise exception 'too_many_unanswered' using errcode = '53400';
  end if;

  insert into public.support_messages (conversation_id, author, body) values (v_conv.id, 'user', v_body) returning id into v_msg;
  update public.support_conversations
     set status = 'open', resolved_at = null, org_id = coalesce(v_org, org_id),
         support_unread = support_unread + 1, last_author = 'user', last_message_at = clock_timestamp()
   where id = v_conv.id;

  -- Le propriétaire est prévenu (cloche, et push sur son téléphone) au premier message non lu seulement : pas une alerte par message.
  if v_conv.support_unread = 0 then
    insert into public.notifications (user_id, type, title, body, data)
    select pa.user_id, 'support_message', 'Nouveau message au support', left(v_body, 140),
           jsonb_build_object('support_conversation_id', v_conv.id::text)
      from public.platform_admins pa
     where pa.user_id <> v_user;
  end if;
  return v_msg;
end;
$$;

-- La personne a lu les réponses : remet son compteur à zéro et marque lues les notifications de réponse.
create function public.support_mark_read() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.support_conversations set user_unread = 0 where user_id = auth.uid() and user_unread > 0;
  update public.notifications set read_at = now() where user_id = auth.uid() and type = 'support_reply' and read_at is null;
end;
$$;

-- ---------------------------------------------------------------- côté propriétaire (chacune vérifie is_platform_admin)
-- Chiffres de l'en-tête : conversations (toutes, ouvertes, résolues), avec des messages non lus, et nombre de messages non lus.
create function public.admin_support_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'all', count(*),
    'open', count(*) filter (where status = 'open'),
    'resolved', count(*) filter (where status = 'resolved'),
    'unread', count(*) filter (where support_unread > 0),
    'unread_messages', coalesce(sum(support_unread), 0)
  ) into v from public.support_conversations;
  return v;
end;
$$;

-- Liste des conversations, la plus récente d'abord. p_filter : 'all' | 'unread' | 'open' | 'resolved' (null = toutes).
-- La recherche porte sur l'adresse e-mail, le nom, l'espace de travail et le texte des messages.
create function public.admin_support_conversations(
  p_filter text default null, p_search text default null, p_limit int default 25, p_offset int default 0
) returns table (
  id uuid, user_id uuid, display_name text, email text, org_id uuid, org_name text, status text,
  support_unread int, user_unread int, message_count int, last_message_at timestamptz, last_author text, last_body text,
  created_at timestamptz, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_pattern text := public.admin_like_pattern(p_search);
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_filter is not null and p_filter not in ('all', 'unread', 'open', 'resolved') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;

  return query
  select
    c.id, c.user_id, p.display_name, u.email::text, c.org_id, o.name, c.status, c.support_unread, c.user_unread,
    (select count(*)::int from public.support_messages m where m.conversation_id = c.id),
    c.last_message_at, c.last_author,
    (select left(m.body, 200) from public.support_messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1),
    c.created_at, count(*) over ()
  from public.support_conversations c
  join auth.users u on u.id = c.user_id
  left join public.profiles p on p.id = c.user_id
  left join public.organizations o on o.id = c.org_id
  where (p_filter is null or p_filter = 'all'
         or (p_filter = 'unread' and c.support_unread > 0)
         or (p_filter = 'open' and c.status = 'open')
         or (p_filter = 'resolved' and c.status = 'resolved'))
    and (v_pattern is null
         or u.email ilike v_pattern escape '\' or p.display_name ilike v_pattern escape '\' or o.name ilike v_pattern escape '\'
         or exists (select 1 from public.support_messages m where m.conversation_id = c.id and m.body ilike v_pattern escape '\'))
  order by c.last_message_at desc, c.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Une conversation et ses derniers messages (p_limit, 200 par défaut, 500 au plus), du plus ancien au plus récent. Null si elle n'existe pas.
create function public.admin_support_thread(p_id uuid, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_conv jsonb;
  v_total int;
  v_msgs jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'id', c.id, 'user_id', c.user_id, 'display_name', p.display_name, 'email', u.email::text,
           'org_id', c.org_id, 'org_name', o.name, 'status', c.status,
           'support_unread', c.support_unread, 'user_unread', c.user_unread,
           'created_at', c.created_at, 'last_message_at', c.last_message_at, 'resolved_at', c.resolved_at)
    into v_conv
    from public.support_conversations c
    join auth.users u on u.id = c.user_id
    left join public.profiles p on p.id = c.user_id
    left join public.organizations o on o.id = c.org_id
   where c.id = p_id;
  if v_conv is null then
    return null;
  end if;

  select count(*) into v_total from public.support_messages where conversation_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'author', x.author, 'body', x.body, 'created_at', x.created_at) order by x.created_at, x.id), '[]'::jsonb)
    into v_msgs
    from (select m.* from public.support_messages m where m.conversation_id = p_id order by m.created_at desc, m.id desc limit v_limit) x;

  return jsonb_build_object('conversation', v_conv, 'messages', v_msgs, 'truncated', v_total > v_limit);
end;
$$;

-- Le propriétaire a lu la conversation.
create function public.admin_support_mark_read(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.support_conversations set support_unread = 0 where id = p_id and support_unread > 0;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and type = 'support_message' and read_at is null and data ->> 'support_conversation_id' = p_id::text;
end;
$$;

-- Répond à l'utilisateur (4 000 caractères au plus). Le message compte comme lu côté support, et l'utilisateur reçoit une notification
-- (cloche du site, notifications de l'application, push) : table `notifications`, déjà relayée par l'Edge Function `send-push`.
create function public.admin_support_reply(p_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_body text := public.support_clean_body(p_body);
  v_conv public.support_conversations;
  v_msg uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'message_too_long' using errcode = '22001';
  end if;

  select * into v_conv from public.support_conversations where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.support_messages (conversation_id, author, body) values (v_conv.id, 'support', v_body) returning id into v_msg;
  update public.support_conversations
     set user_unread = user_unread + 1, support_unread = 0, last_author = 'support', last_message_at = clock_timestamp()
   where id = v_conv.id;

  insert into public.notifications (user_id, type, title, body, data)
  values (v_conv.user_id, 'support_reply', 'Support Postbiz', left(v_body, 140), jsonb_build_object('screen', 'support'));
  return v_msg;
end;
$$;

-- Marque la conversation résolue ('resolved') ou la rouvre ('open'). Résoudre la marque aussi comme lue.
create function public.admin_support_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('open', 'resolved') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.support_conversations
     set status = p_status,
         resolved_at = case when p_status = 'resolved' then coalesce(resolved_at, now()) else null end,
         support_unread = case when p_status = 'resolved' then 0 else support_unread end
   where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------- droits d'exécution
revoke execute on function public.support_send(text, uuid) from public, anon;
revoke execute on function public.support_mark_read() from public, anon;
revoke execute on function public.admin_support_summary() from public, anon;
revoke execute on function public.admin_support_conversations(text, text, int, int) from public, anon;
revoke execute on function public.admin_support_thread(uuid, int) from public, anon;
revoke execute on function public.admin_support_mark_read(uuid) from public, anon;
revoke execute on function public.admin_support_reply(uuid, text) from public, anon;
revoke execute on function public.admin_support_set_status(uuid, text) from public, anon;
grant execute on function public.support_send(text, uuid) to authenticated, service_role;
grant execute on function public.support_mark_read() to authenticated, service_role;
grant execute on function public.admin_support_summary() to authenticated, service_role;
grant execute on function public.admin_support_conversations(text, text, int, int) to authenticated, service_role;
grant execute on function public.admin_support_thread(uuid, int) to authenticated, service_role;
grant execute on function public.admin_support_mark_read(uuid) to authenticated, service_role;
grant execute on function public.admin_support_reply(uuid, text) to authenticated, service_role;
grant execute on function public.admin_support_set_status(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- temps réel
-- L'utilisateur reçoit les réponses (support_messages) et la mise à jour de son compteur (support_conversations) en direct ;
-- la RLS ci-dessus décide de ce que chaque abonné reçoit. Le propriétaire n'a pas d'abonnement : son écran interroge la base à intervalle court.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.support_conversations, public.support_messages;
  end if;
end;
$$;
