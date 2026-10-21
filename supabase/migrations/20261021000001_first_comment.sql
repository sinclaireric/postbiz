-- Postbiz : premier commentaire d'une publication. Un texte publié en commentaire sous la publication, juste après elle
-- (Facebook, LinkedIn ; sur X, une réponse). Le worker le traite comme le reste : réclamé (« posting »), puis « posted », « failed »
-- (refus du réseau : on peut réessayer) ou « unknown » (issue incertaine : jamais rejoué, l'utilisateur vérifie sur le réseau).

create type public.first_comment_state as enum ('pending', 'posting', 'posted', 'failed', 'unknown');

alter table public.posts
  add column first_comment text check (first_comment is null or char_length(btrim(first_comment)) between 1 and 8000),
  add column first_comment_state public.first_comment_state,
  add column first_comment_id text,
  add column first_comment_error text,
  add constraint posts_first_comment_coherent check ((first_comment is null) = (first_comment_state is null));

-- Un client n'écrit que le texte : l'état, l'identifiant et l'erreur appartiennent au worker. À la création, ou quand le texte change,
-- le suivi repart de zéro (« pending » s'il y a un texte, rien sinon), quelles que soient les valeurs envoyées.
create function public.posts_first_comment_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.first_comment is distinct from old.first_comment then
    new.first_comment_state := case when new.first_comment is null then null else 'pending' end;
    new.first_comment_id := null;
    new.first_comment_error := null;
  end if;
  return new;
end;
$$;

create trigger posts_first_comment_guard before insert or update on public.posts
  for each row execute function public.posts_first_comment_guard();

-- Réclame les premiers commentaires à publier : la publication est partie (« published ») et le commentaire attend (« pending »).
-- Même principe que claim_due_posts : verrouillé pour un seul worker, avec une durée de verrou après laquelle le balayage conclut « unknown ».
create function public.claim_first_comments(p_limit int default 10, p_lock_seconds int default 300)
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
    order by q.publish_at nulls last, q.created_at
    limit p_limit
    for update of q skip locked
  )
  returning p.*;
$$;

-- « Réessayer » : un commentaire refusé par le réseau (rien n'est parti) repasse en file. Un administrateur ou un membre de l'organisation.
create function public.retry_first_comment(p_post_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.posts where id = p_post_id and deleted_at is null;
  if v_org is null or not public.has_org_role(v_org, array['admin', 'member']::public.org_role[]) then
    return false;
  end if;
  update public.posts
  set first_comment_state = 'pending', first_comment_error = null
  where id = p_post_id and state = 'published' and first_comment_state = 'failed';
  return found;
end;
$$;

-- Balayage du travail abandonné : on y ajoute les premiers commentaires dont le worker ne s'est pas terminé (le reste est inchangé).
create or replace function public.sweep_stale_work() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_posts int;
  v_messages int;
  v_comments int;
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

  update public.posts
  set first_comment_state = 'unknown', locked_until = null,
      first_comment_error = 'Résultat inconnu : le worker ne s''est pas terminé. Vérifiez sous la publication avant de recommenter.'
  where state = 'published' and first_comment_state = 'posting' and locked_until < now();
  get diagnostics v_comments = row_count;

  return jsonb_build_object('posts_unknown', v_posts, 'messages_failed', v_messages, 'comments_unknown', v_comments);
end;
$$;

revoke execute on function public.claim_first_comments(int, int) from public, anon, authenticated;
grant execute on function public.claim_first_comments(int, int) to service_role;
revoke execute on function public.retry_first_comment(uuid) from public, anon;
grant execute on function public.retry_first_comment(uuid) to authenticated, service_role;
