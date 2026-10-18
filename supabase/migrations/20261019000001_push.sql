-- Postbiz : notifications push.
--  1. claim_push_token : l'appareil appartient à celui qui est connecté (un jeton déjà lié à un autre compte est repris).
--  2. push_dispatch    : trigger qui prévient l'Edge Function `send-push` (pg_net) à chaque notification et message entrant.

-- ---------------------------------------------------------------- 1. enregistrement d'un jeton
-- La RLS de push_tokens (user_id = auth.uid()) interdit à un client de reprendre un jeton lié à un autre compte
-- (appareil prêté, déconnexion sans passage réseau) : le upsert échoue sur la ligne de l'ancien compte.
-- Ce RPC fait le transfert. Un jeton Expo n'est connu que de son appareil : le risque d'un tiers qui « vole »
-- le jeton d'un autre est celui de connaître un secret qu'il n'a, par construction, pas.
create function public.claim_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android', 'web') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;

  insert into public.push_tokens (user_id, token, platform)
  values (auth.uid(), btrim(p_token), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform;
end;
$$;

revoke execute on function public.claim_push_token(text, text) from public, anon;
grant execute on function public.claim_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------- 2. déclenchement de l'envoi
-- Configuration dans le Vault Supabase (voir README) : `push_function_url` (URL de la fonction send-push)
-- et `push_function_secret` (même valeur que le secret PUSH_WEBHOOK_SECRET de la fonction).
-- Tant que l'un manque, ou que pg_net / le Vault sont absents, le trigger ne fait rien.
-- Il ne doit JAMAIS faire échouer l'écriture qui l'a déclenché (ingestion d'un message, notification du worker) :
-- toute erreur est avalée et signalée en WARNING. pg_net est asynchrone et n'est pas rejoué : un push peut se perdre
-- (la notification et le message restent en base et dans l'application).
create function public.push_dispatch() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
  v_record jsonb;
begin
  begin
    if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
       or to_regclass('vault.decrypted_secrets') is null then
      return null;
    end if;

    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url' limit 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_function_secret' limit 1;
    if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
      return null;
    end if;

    if tg_table_name = 'messages' then
      -- seuls les champs utiles : ni `raw` ni le détail des pièces jointes
      v_record := jsonb_build_object(
        'id', new.id, 'org_id', new.org_id, 'conversation_id', new.conversation_id,
        'direction', new.direction, 'body', left(coalesce(new.body, ''), 500),
        'has_attachments', jsonb_array_length(new.attachments) > 0
      );
    else
      v_record := to_jsonb(new);
    end if;

    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('type', 'INSERT', 'schema', tg_table_schema, 'table', tg_table_name, 'record', v_record, 'old_record', null),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'push_dispatch : %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.push_dispatch() from public, anon, authenticated;

create trigger notifications_push after insert on public.notifications
  for each row execute function public.push_dispatch();
create trigger messages_push after insert on public.messages
  for each row when (new.direction = 'in') execute function public.push_dispatch();
