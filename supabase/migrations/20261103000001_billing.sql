-- Postbiz : facturation. Offres Gratuit / Standard / Team / Agence, paiements Stripe (carte) et PawaPay (mobile money prépayé), abonnements offerts.
--
-- Principes :
--  - l'abonnement est rattaché à l'organisation (espace de travail), comme `subscriptions` l'a toujours été ;
--  - aucune écriture client : paiements, abonnements et événements ne s'écrivent que par le service_role (webhooks, retours de paiement, rapprochement)
--    ou par les fonctions `admin_*` (propriétaire de la plateforme) ;
--  - l'offre RÉELLEMENT applicable (`org_plan`) se déduit des dates : essai en cours, période payée, délai de grâce, sinon Gratuit. Rien n'est supprimé
--    quand une période se termine, et aucune tâche planifiée n'est nécessaire pour rétrograder ;
--  - tant que `billing_settings.enabled` est faux (bêta gratuite), aucune limite n'est appliquée : `org_plan_limit` renvoie « illimité ».

-- ---------------------------------------------------------------- 1. interrupteur de la facturation
create table public.billing_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.billing_settings (id) values (true);
alter table public.billing_settings enable row level security;
revoke all on public.billing_settings from anon, authenticated;

create function public.billing_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.billing_settings where id), false);
$$;
revoke execute on function public.billing_enabled() from public;
grant execute on function public.billing_enabled() to anon, authenticated, service_role;

create function public.admin_set_billing_enabled(p_enabled boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.billing_settings set enabled = coalesce(p_enabled, false), updated_at = now() where id;
  return coalesce(p_enabled, false);
end;
$$;
revoke execute on function public.admin_set_billing_enabled(boolean) from public, anon;
grant execute on function public.admin_set_billing_enabled(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. offres et colonnes de l'abonnement
-- starter → free, pro → standard ; team est inchangée. Aucune ligne n'était payante avant cette migration.
alter table public.subscriptions drop constraint subscriptions_plan_check;
update public.subscriptions set plan = case plan when 'starter' then 'free' when 'pro' then 'standard' else plan end;
alter table public.subscriptions add constraint subscriptions_plan_check check (plan in ('free', 'standard', 'team', 'agency'));
alter table public.subscriptions alter column plan set default 'free';

alter table public.subscriptions
  add column provider text not null default 'none' check (provider in ('none', 'stripe', 'pawapay', 'gift')),
  add column currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  add column country text check (country is null or country ~ '^[A-Z]{2}$'),
  -- Ce que l'abonnement rapporte par mois, en dollars, au prix réellement payé (remise locale et annuelle comprises) : base du MRR.
  add column monthly_usd numeric(10, 2) check (monthly_usd is null or monthly_usd >= 0),
  -- Après la fin de la période payée, l'offre reste applicable jusqu'à cette date (retard de paiement, mobile money non renouvelé).
  add column grace_ends_at timestamptz,
  add column gift_note text check (gift_note is null or char_length(gift_note) <= 500),
  add column gifted_by uuid references auth.users (id) on delete set null;
update public.subscriptions set provider = 'stripe' where stripe_subscription_id is not null;

-- L'offre applicable d'après les dates (voir l'en-tête).
create function public.subscription_effective_plan(
  p_plan text, p_status public.subscription_status, p_trial_ends_at timestamptz, p_period_end timestamptz, p_grace_ends_at timestamptz
) returns text
language sql stable set search_path = public as $$
  select case
    when p_plan is null then 'free'
    when p_status = 'trialing' and p_trial_ends_at > now() then p_plan
    when p_status = 'active' and (p_period_end is null or p_period_end > now()) then p_plan
    when p_status in ('active', 'past_due') and p_grace_ends_at > now() then p_plan
    else 'free'
  end;
$$;
revoke execute on function public.subscription_effective_plan(text, public.subscription_status, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.subscription_effective_plan(text, public.subscription_status, timestamptz, timestamptz, timestamptz) to authenticated, service_role;

-- Interne : l'offre applicable d'une organisation (Gratuit si elle n'a pas d'abonnement).
create function public.org_plan(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.subscription_effective_plan(s.plan, s.status, s.trial_ends_at, s.current_period_end, s.grace_ends_at)
    from public.subscriptions s where s.org_id = p_org
  ), 'free');
$$;
revoke execute on function public.org_plan(uuid) from public, anon, authenticated;
grant execute on function public.org_plan(uuid) to service_role;

-- ---------------------------------------------------------------- 3. limites par offre
-- `value` nul = illimité. Les mêmes valeurs sont affichées par le site (apps/web/src/lib/billing/plans.ts) : un test vérifie qu'elles concordent.
create table public.plan_limits (
  plan text not null check (plan in ('free', 'standard', 'team', 'agency')),
  key text not null check (key in ('channels', 'members', 'images_per_month', 'videos_per_month', 'ai_text_per_month', 'knowledge_files', 'knowledge_sites', 'storage_mb', 'analytics_days')),
  value int check (value is null or value >= 0),
  primary key (plan, key)
);
alter table public.plan_limits enable row level security;
create policy plan_limits_select on public.plan_limits for select to anon, authenticated using (true);
revoke insert, update, delete on public.plan_limits from anon, authenticated;

insert into public.plan_limits (plan, key, value) values
  ('free',     'channels',          3), ('free',     'members',  1), ('free',     'images_per_month',   5), ('free',     'videos_per_month',  0), ('free',     'ai_text_per_month',   30),
  ('free',     'knowledge_files',   5), ('free',     'knowledge_sites', 1), ('free',     'storage_mb',       500), ('free',     'analytics_days',   30),
  ('standard', 'channels',          5), ('standard', 'members',  3), ('standard', 'images_per_month',  30), ('standard', 'videos_per_month',  3), ('standard', 'ai_text_per_month',  300),
  ('standard', 'knowledge_files',  20), ('standard', 'knowledge_sites', 3), ('standard', 'storage_mb',      5000), ('standard', 'analytics_days',   90),
  ('team',     'channels',         30), ('team',     'members', 10), ('team',     'images_per_month',  150), ('team',     'videos_per_month', 15), ('team',     'ai_text_per_month', 1500),
  ('team',     'knowledge_files',  40), ('team',     'knowledge_sites', 5), ('team',     'storage_mb',     25000), ('team',     'analytics_days',  365),
  ('agency',   'channels',        100), ('agency',   'members', 25), ('agency',   'images_per_month',  400), ('agency',   'videos_per_month', 40), ('agency',   'ai_text_per_month', 5000),
  ('agency',   'knowledge_files',  80), ('agency',   'knowledge_sites', 20), ('agency',   'storage_mb',    100000), ('agency',   'analytics_days',  730);

-- Limite d'une organisation pour une clé : nul = illimité (ou facturation désactivée). Un membre de l'organisation (ou le service) seulement.
create function public.org_plan_limit(p_org uuid, p_key text) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.plan_limits where key = p_key) then
    raise exception 'unknown plan limit %', p_key using errcode = '22023';
  end if;
  if not public.billing_enabled() then
    return null;
  end if;
  select l.value into v_limit from public.plan_limits l where l.plan = public.org_plan(p_org) and l.key = p_key;
  return v_limit;
end;
$$;
revoke execute on function public.org_plan_limit(uuid, text) from public, anon;
grant execute on function public.org_plan_limit(uuid, text) to authenticated, service_role;

-- Offre applicable, usage et limites, pour la page Facturation. Les limites sont celles de l'offre même si la facturation est désactivée (`enabled`).
create function public.org_usage(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_plan text;
  v_month timestamptz := date_trunc('month', now());
begin
  if not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_plan := public.org_plan(p_org);
  return jsonb_build_object(
    'enabled', public.billing_enabled(),
    'plan', v_plan,
    'usage', jsonb_build_object(
      'channels', (select count(*) from public.integrations where org_id = p_org and deleted_at is null),
      'members', (select count(*) from public.memberships where org_id = p_org),
      'images_per_month', (select count(*) from public.ai_generations where org_id = p_org and kind = 'image' and created_at >= v_month),
      'videos_per_month', (select count(*) from public.ai_generations where org_id = p_org and kind = 'video' and created_at >= v_month),
      'ai_text_per_month', (select count(*) from public.ai_text_usage where org_id = p_org and created_at >= v_month),
      'storage_mb', (select coalesce(sum(size_bytes), 0) / 1048576 from public.media where org_id = p_org)
    ),
    'limits', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.plan_limits where plan = v_plan)
  );
end;
$$;
revoke execute on function public.org_usage(uuid) from public, anon;
grant execute on function public.org_usage(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- 4. paiements et événements
-- Une ligne par paiement : tentative de mobile money (pending → succeeded | failed), facture Stripe payée, abonnement offert (montant 0).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  provider text not null check (provider in ('stripe', 'pawapay', 'gift')),
  -- Identifiant chez le fournisseur : dépôt PawaPay (notre UUID), facture Stripe, ou UUID de l'offre.
  provider_ref text not null check (char_length(provider_ref) between 1 and 200),
  plan text not null check (plan in ('standard', 'team', 'agency')),
  billing_interval public.billing_interval not null,
  months int not null default 1 check (months between 1 and 120),
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Équivalent en dollars au taux du jour : le MRR et les remboursements se comptent dans une seule devise.
  usd_amount numeric(12, 2) not null check (usd_amount >= 0),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'expired', 'refunded')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 200),
  period_start timestamptz,
  period_end timestamptz,
  -- Date à laquelle le temps restant de ce paiement a été converti en changeant d'offre (il ne peut l'être qu'une fois).
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider, provider_ref),
  constraint payments_period_order check (period_start is null or period_end is null or period_end >= period_start)
);
create index payments_org_idx on public.payments (org_id, created_at desc);
create index payments_pending_idx on public.payments (created_at) where status = 'pending';

alter table public.payments enable row level security;
-- Seuls les administrateurs de l'organisation lisent ses paiements ; personne ne les écrit côté client.
create policy payments_select on public.payments for select to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));
revoke insert, update, delete on public.payments from anon, authenticated;
revoke all on public.payments from anon;

-- Événements de paiement déjà traités (un identifiant d'événement ne s'applique qu'une fois, même relivré).
create table public.billing_events (
  provider text not null check (provider in ('stripe', 'pawapay')),
  event_id text not null check (char_length(event_id) between 1 and 200),
  event_type text,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

-- ---------------------------------------------------------------- 5. mobile money : règlement d'un paiement vérifié
-- À n'appeler qu'APRÈS avoir relu le dépôt chez PawaPay (statut COMPLETED, montant et devise reçus). Idempotent : un dépôt ne s'applique qu'une fois.
--  - même offre encore valable : la période payée s'ajoute à la fin de la période en cours ;
--  - autre offre : la valeur restante des paiements de l'ancienne offre (en dollars) est convertie en temps de la nouvelle, sans dépasser une période ;
--  - abonnement Stripe encore actif : le paiement est enregistré mais l'abonnement n'est pas touché (`manual_review`), pour ne pas écraser Stripe.
create function public.billing_settle_payment(p_provider text, p_ref text, p_amount numeric, p_currency text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.payments%rowtype;
  s public.subscriptions%rowtype;
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_len interval;
  v_extra interval := interval '0';
  v_credit numeric := 0;
  v_new_usd numeric;
  v_has boolean;
begin
  select * into p from public.payments where provider = p_provider and provider_ref = p_ref for update;
  if not found then
    return jsonb_build_object('result', 'unknown');
  end if;
  if p.status = 'succeeded' then
    return jsonb_build_object('result', 'already', 'org_id', p.org_id);
  end if;
  if p.status = 'refunded' then
    return jsonb_build_object('result', 'refunded', 'org_id', p.org_id);
  end if;
  if p_amount is distinct from p.amount or p_currency is distinct from p.currency then
    update public.payments set status = 'failed', failure_reason = 'amount_mismatch', completed_at = v_now where id = p.id;
    return jsonb_build_object('result', 'mismatch', 'org_id', p.org_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing:' || p.org_id::text, 0));
  select * into s from public.subscriptions where org_id = p.org_id for update;
  v_has := found;

  if v_has and s.provider = 'stripe' and s.status in ('active', 'past_due') and coalesce(s.current_period_end, v_now) > v_now then
    update public.payments set status = 'succeeded', failure_reason = 'manual_review', completed_at = v_now where id = p.id;
    return jsonb_build_object('result', 'review', 'org_id', p.org_id);
  end if;

  v_len := make_interval(months => p.months);
  if v_has and s.status = 'active' and s.plan = p.plan and s.current_period_end > v_now then
    v_start := s.current_period_end;
  else
    v_start := v_now;
    if v_has and s.status = 'active' and s.plan <> p.plan and s.current_period_end > v_now then
      select coalesce(sum(x.usd_amount * extract(epoch from (x.period_end - greatest(x.period_start, v_now))) / extract(epoch from (x.period_end - x.period_start))), 0)
        into v_credit
        from public.payments x
        where x.org_id = p.org_id and x.provider = 'pawapay' and x.status = 'succeeded' and x.credited_at is null
          and x.plan <> p.plan and x.usd_amount > 0 and x.period_end > v_now and x.period_end > x.period_start;
      v_new_usd := p.usd_amount;
      if v_credit > 0 and v_new_usd > 0 then
        v_extra := v_len * least(v_credit / v_new_usd, 1.0)::float8;
      end if;
      update public.payments set credited_at = v_now
        where org_id = p.org_id and provider = 'pawapay' and status = 'succeeded' and credited_at is null and plan <> p.plan and period_end > v_now;
    end if;
  end if;
  v_end := v_start + v_len + v_extra;

  insert into public.subscriptions as t (org_id, plan, status, billing_interval, current_period_end, cancel_at_period_end, canceled_at, provider, currency, country, monthly_usd, grace_ends_at)
  values (p.org_id, p.plan, 'active', case when p.months >= 12 then 'yearly' else 'monthly' end::public.billing_interval, v_end, false, null,
          'pawapay', p.currency, p.country, round(p.usd_amount / p.months, 2), v_end + interval '7 days')
  on conflict (org_id) do update set
    plan = excluded.plan, status = 'active', billing_interval = excluded.billing_interval, current_period_end = excluded.current_period_end,
    cancel_at_period_end = false, canceled_at = null, provider = 'pawapay', currency = excluded.currency, country = excluded.country,
    monthly_usd = excluded.monthly_usd, grace_ends_at = excluded.grace_ends_at, gift_note = null, gifted_by = null;

  update public.payments set status = 'succeeded', failure_reason = null, completed_at = v_now, period_start = v_start, period_end = v_end where id = p.id;
  return jsonb_build_object('result', 'ok', 'org_id', p.org_id, 'period_end', v_end);
end;
$$;
revoke execute on function public.billing_settle_payment(text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.billing_settle_payment(text, text, numeric, text) to service_role;

-- Dépôt refusé, abandonné ou expiré chez le fournisseur (confirmé par lui). N'écrase jamais un paiement réussi.
create function public.billing_fail_payment(p_provider text, p_ref text, p_reason text, p_expired boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.payments
  set status = case when p_expired then 'expired' else 'failed' end, failure_reason = left(p_reason, 200), completed_at = now()
  where provider = p_provider and provider_ref = p_ref and status = 'pending';
  return found;
end;
$$;
revoke execute on function public.billing_fail_payment(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.billing_fail_payment(text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------- 6. Stripe : état de l'abonnement et factures payées
-- L'événement n'est qu'un déclencheur : le site relit l'abonnement chez Stripe et passe ici son ÉTAT (pas un delta), donc l'ordre des événements
-- n'importe pas. Idempotent par identifiant d'événement ; l'enregistrement de l'événement et ses effets forment une seule transaction.
-- p_sub  : plan, status, interval, current_period_end, cancel_at_period_end, customer, subscription, currency, country, monthly_usd
-- p_payment (facultatif) : invoice, plan, interval, amount, currency, usd_amount, country, period_start, period_end, user_id
create function public.billing_apply_stripe(p_event_id text, p_event_type text, p_org uuid, p_sub jsonb, p_payment jsonb default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_inserted int;
  v_status public.subscription_status;
  v_period_end timestamptz;
  v_grace timestamptz;
  v_months int;
begin
  insert into public.billing_events (provider, event_id, event_type) values ('stripe', p_event_id, p_event_type) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 'duplicate';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    return 'unknown_org';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_org::text, 0));

  if p_sub is not null then
    if (p_sub ->> 'plan') not in ('standard', 'team', 'agency') or (p_sub ->> 'status') not in ('active', 'past_due', 'canceled') then
      raise exception 'billing_apply_stripe : abonnement invalide' using errcode = '22023';
    end if;
    v_status := (p_sub ->> 'status')::public.subscription_status;
    v_period_end := (p_sub ->> 'current_period_end')::timestamptz;
    v_grace := case v_status
      when 'active' then v_period_end + interval '3 days'          -- délai de traitement du renouvellement
      when 'past_due' then coalesce((select grace_ends_at from public.subscriptions where org_id = p_org and grace_ends_at > now()), now() + interval '7 days')
      else null
    end;
    insert into public.subscriptions as t (
      org_id, plan, status, billing_interval, current_period_end, cancel_at_period_end, canceled_at,
      stripe_customer_id, stripe_subscription_id, provider, currency, country, monthly_usd, grace_ends_at
    ) values (
      p_org, p_sub ->> 'plan', v_status, (p_sub ->> 'interval')::public.billing_interval, v_period_end,
      coalesce((p_sub ->> 'cancel_at_period_end')::boolean, false), case when v_status = 'canceled' then now() end,
      p_sub ->> 'customer', p_sub ->> 'subscription', 'stripe', p_sub ->> 'currency', p_sub ->> 'country',
      (p_sub ->> 'monthly_usd')::numeric, v_grace
    )
    on conflict (org_id) do update set
      plan = excluded.plan, status = excluded.status, billing_interval = excluded.billing_interval, current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at,
      stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
      provider = 'stripe', currency = excluded.currency, country = excluded.country, monthly_usd = excluded.monthly_usd,
      grace_ends_at = excluded.grace_ends_at, gift_note = null, gifted_by = null;
  end if;

  if p_payment is not null then
    v_months := case when (p_payment ->> 'interval') = 'yearly' then 12 else 1 end;
    insert into public.payments (
      org_id, user_id, provider, provider_ref, plan, billing_interval, months, amount, currency, usd_amount, country, status, period_start, period_end, completed_at
    ) values (
      p_org, nullif(p_payment ->> 'user_id', '')::uuid, 'stripe', p_payment ->> 'invoice', p_payment ->> 'plan', (p_payment ->> 'interval')::public.billing_interval,
      v_months, (p_payment ->> 'amount')::numeric, p_payment ->> 'currency', (p_payment ->> 'usd_amount')::numeric, p_payment ->> 'country', 'succeeded',
      (p_payment ->> 'period_start')::timestamptz, (p_payment ->> 'period_end')::timestamptz, now()
    ) on conflict (provider, provider_ref) do nothing;
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.billing_apply_stripe(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.billing_apply_stripe(text, text, uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------- 7. fin de période (à appeler une fois par jour)
-- L'offre applicable se calcule déjà d'après les dates ; ceci aligne le STATUT affiché par l'espace propriétaire : mobile money non renouvelé
-- (en retard pendant le délai de grâce, puis terminé) et abonnement offert arrivé à son terme. Les abonnements Stripe suivent ses webhooks.
create function public.billing_expire_lapsed() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_late int;
  v_ended int;
begin
  update public.subscriptions set status = 'past_due'
  where provider = 'pawapay' and status = 'active' and current_period_end <= now() and grace_ends_at > now();
  get diagnostics v_late = row_count;

  update public.subscriptions set status = 'canceled', canceled_at = now()
  where provider in ('pawapay', 'gift') and status in ('active', 'past_due')
    and coalesce(grace_ends_at, current_period_end) is not null and coalesce(grace_ends_at, current_period_end) <= now();
  get diagnostics v_ended = row_count;
  return jsonb_build_object('past_due', v_late, 'ended', v_ended);
end;
$$;
revoke execute on function public.billing_expire_lapsed() from public, anon, authenticated;
grant execute on function public.billing_expire_lapsed() to service_role;

-- ---------------------------------------------------------------- 8. abonnement offert (propriétaire de la plateforme)
create function public.admin_grant_subscription(p_org uuid, p_plan text, p_until timestamptz, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.subscriptions%rowtype;
  v_ref text := gen_random_uuid()::text;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_plan not in ('standard', 'team', 'agency') then
    raise exception 'invalid plan' using errcode = '22023';
  end if;
  if p_until is null or p_until <= now() or p_until > now() + interval '5 years' then
    raise exception 'invalid end date' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'organization not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_org::text, 0));
  select * into s from public.subscriptions where org_id = p_org for update;
  -- Un abonnement réellement payé n'est jamais écrasé par un cadeau.
  if found and s.provider in ('stripe', 'pawapay') and s.status in ('active', 'past_due') and coalesce(s.grace_ends_at, s.current_period_end) > now() then
    raise exception 'has paid subscription' using errcode = '23514';
  end if;

  insert into public.subscriptions as t (org_id, plan, status, billing_interval, current_period_end, cancel_at_period_end, canceled_at, provider, monthly_usd, grace_ends_at, gift_note, gifted_by)
  values (p_org, p_plan, 'active', 'monthly', p_until, false, null, 'gift', 0, null, nullif(btrim(p_note), ''), auth.uid())
  on conflict (org_id) do update set
    plan = excluded.plan, status = 'active', billing_interval = 'monthly', current_period_end = excluded.current_period_end, cancel_at_period_end = false,
    canceled_at = null, provider = 'gift', currency = null, country = null, monthly_usd = 0, grace_ends_at = null,
    gift_note = excluded.gift_note, gifted_by = excluded.gifted_by;

  insert into public.payments (org_id, user_id, provider, provider_ref, plan, billing_interval, months, amount, currency, usd_amount, status, failure_reason, period_start, period_end, completed_at)
  values (p_org, auth.uid(), 'gift', v_ref, p_plan, 'monthly', 1, 0, 'USD', 0, 'succeeded', left(nullif(btrim(p_note), ''), 200), now(), p_until, now());
  return jsonb_build_object('org_id', p_org, 'plan', p_plan, 'until', p_until);
end;
$$;

-- Retire un abonnement offert (sans toucher à un abonnement payé).
create function public.admin_revoke_gift(p_org uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.subscriptions
  set status = 'canceled', canceled_at = now(), current_period_end = least(coalesce(current_period_end, now()), now())
  where org_id = p_org and provider = 'gift' and status = 'active';
  return found;
end;
$$;
revoke execute on function public.admin_grant_subscription(uuid, text, timestamptz, text) from public, anon;
revoke execute on function public.admin_revoke_gift(uuid) from public, anon;
grant execute on function public.admin_grant_subscription(uuid, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.admin_revoke_gift(uuid) to authenticated, service_role;

-- Derniers paiements de la plateforme (propriétaire seulement).
create function public.admin_payments(p_limit int default 25, p_offset int default 0) returns table (
  id uuid, org_id uuid, org_name text, owner_email text, provider text, plan text, months int, amount numeric, currency text, usd_amount numeric,
  country text, status text, failure_reason text, created_at timestamptz, completed_at timestamptz, period_end timestamptz, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select p.id, p.org_id, o.name, (select u.email::text from auth.users u where u.id = coalesce(o.created_by, p.user_id)),
         p.provider, p.plan, p.months, p.amount, p.currency, p.usd_amount, p.country, p.status, p.failure_reason, p.created_at, p.completed_at, p.period_end,
         count(*) over ()
  from public.payments p join public.organizations o on o.id = p.org_id
  order by p.created_at desc, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke execute on function public.admin_payments(int, int) from public, anon;
grant execute on function public.admin_payments(int, int) to authenticated, service_role;

-- ---------------------------------------------------------------- 9. essai gratuit : 14 jours de l'offre Standard, une fois par personne
-- Reprend à l'identique la logique de la migration des espaces de travail (user_trials) ; seule l'offre de l'essai change (pro → standard).
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
  values (new.id, 'standard', 'trialing', v_started + interval '14 days')
  on conflict (org_id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------- 10. limites appliquées par la base
-- Canaux : un NOUVEAU canal (ou la réactivation d'un canal supprimé) est refusé au-delà de la limite de l'offre ; reconnecter un canal actif reste permis.
create or replace function public.connect_integration(
  p_org uuid,
  p_provider public.social_provider,
  p_internal_id text,
  p_name text,
  p_username text,
  p_picture_url text,
  p_settings jsonb,
  p_token_expires_at timestamptz,
  p_access_token_enc text,
  p_refresh_token_enc text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_limit int;
begin
  if not exists (
    select 1 from public.integrations where org_id = p_org and provider = p_provider and internal_id = p_internal_id and deleted_at is null
  ) then
    perform pg_advisory_xact_lock(hashtextextended('channels:' || p_org::text, 0));
    v_limit := public.org_plan_limit(p_org, 'channels');
    if v_limit is not null and (select count(*) from public.integrations where org_id = p_org and deleted_at is null) >= v_limit then
      raise exception 'channel_limit' using errcode = '23514', detail = v_limit::text;
    end if;
  end if;

  insert into public.integrations (org_id, provider, internal_id, name, username, picture_url, settings, token_expires_at, status)
  values (p_org, p_provider, p_internal_id, p_name, p_username, p_picture_url, coalesce(p_settings, '{}'::jsonb), p_token_expires_at, 'active')
  on conflict (org_id, provider, internal_id) do update set
    name = excluded.name,
    username = excluded.username,
    picture_url = excluded.picture_url,
    settings = public.integrations.settings || excluded.settings,
    token_expires_at = excluded.token_expires_at,
    status = 'active',
    deleted_at = null,
    refresh_locked_until = null
  returning id into v_id;

  insert into public.integration_secrets (integration_id, access_token_enc, refresh_token_enc)
  values (v_id, p_access_token_enc, p_refresh_token_enc)
  on conflict (integration_id) do update set
    access_token_enc = excluded.access_token_enc,
    refresh_token_enc = coalesce(excluded.refresh_token_enc, public.integration_secrets.refresh_token_enc);

  return v_id;
end;
$$;

-- Texte généré par l'IA (assistant du composeur, suggestions de réponse, agent) : journal en ajout seul, comme `ai_generations`.
create table public.ai_text_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('assistant', 'suggestion', 'agent')),
  created_at timestamptz not null default now()
);
create index ai_text_usage_quota_idx on public.ai_text_usage (org_id, created_at desc);
alter table public.ai_text_usage enable row level security;
revoke all on public.ai_text_usage from anon;
revoke update, delete on public.ai_text_usage from authenticated;
create policy ai_text_usage_select on public.ai_text_usage for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));
create policy ai_text_usage_insert on public.ai_text_usage for insert to authenticated
  with check (user_id = auth.uid() and public.has_org_role(org_id, array['admin', 'member']::public.org_role[]));

-- Réserve une action d'IA texte sous la limite mensuelle de l'offre (calendrier UTC). Vrai et une ligne ajoutée si permis ; faux sinon.
create function public.ai_text_reserve(p_org uuid, p_feature text) returns boolean
language plpgsql set search_path = public as $$
declare
  v_limit int;
  v_used int;
begin
  if p_feature not in ('assistant', 'suggestion', 'agent') then
    raise exception 'ai_text_reserve : fonction invalide' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.has_org_role(p_org, array['admin', 'member']::public.org_role[]) then
    return false;
  end if;
  v_limit := public.org_plan_limit(p_org, 'ai_text_per_month');
  if v_limit is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':text', 0));
    select count(*) into v_used from public.ai_text_usage where org_id = p_org and created_at >= date_trunc('month', now());
    if v_used >= v_limit then
      return false;
    end if;
  end if;
  insert into public.ai_text_usage (org_id, user_id, feature) values (p_org, auth.uid(), p_feature);
  return true;
end;
$$;
revoke execute on function public.ai_text_reserve(uuid, text) from public, anon;
grant execute on function public.ai_text_reserve(uuid, text) to authenticated;

-- Images et vidéos : limite mensuelle de l'offre PUIS plafond journalier anti-abus de `ai_generation_reserve`. Renvoie 'ok', 'monthly', 'daily' ou 'denied'.
create function public.ai_media_reserve(p_org uuid, p_kind text, p_daily_limit int) returns text
language plpgsql set search_path = public as $$
declare
  v_limit int;
  v_used int;
begin
  if p_kind not in ('image', 'video') then
    raise exception 'ai_media_reserve : type invalide' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.has_org_role(p_org, array['admin', 'member']::public.org_role[]) then
    return 'denied';
  end if;
  v_limit := public.org_plan_limit(p_org, case p_kind when 'image' then 'images_per_month' else 'videos_per_month' end);
  if v_limit is not null then
    -- Même verrou que ai_generation_reserve : compter et ajouter forment un tout.
    perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_kind, 0));
    select count(*) into v_used from public.ai_generations where org_id = p_org and kind = p_kind and created_at >= date_trunc('month', now());
    if v_used >= v_limit then
      return 'monthly';
    end if;
  end if;
  if not public.ai_generation_reserve(p_org, p_kind, p_daily_limit) then
    return 'daily';
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.ai_media_reserve(uuid, text, int) from public, anon;
grant execute on function public.ai_media_reserve(uuid, text, int) to authenticated;

-- Stockage : un fichier de plus est refusé quand le total de l'organisation dépasserait la limite de l'offre.
create function public.media_storage_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_limit int;
begin
  v_limit := public.org_plan_limit(new.org_id, 'storage_mb');
  if v_limit is not null
     and (select coalesce(sum(size_bytes), 0) from public.media where org_id = new.org_id) + coalesce(new.size_bytes, 0) > v_limit::bigint * 1048576 then
    raise exception 'storage_limit' using errcode = '23514', detail = v_limit::text;
  end if;
  return new;
end;
$$;
create trigger media_storage_guard before insert on public.media
  for each row execute function public.media_storage_guard();

-- ---------------------------------------------------------------- 11. espace propriétaire : MRR réel, abonnements offerts, fiche utilisateur
create or replace function public.admin_overview() returns jsonb
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
    'gifts', (
      select count(*) from public.subscriptions where provider = 'gift' and status = 'active' and (current_period_end is null or current_period_end > now())
    ),
    -- Organisations par offre, rythme, fournisseur et statut, avec le MRR en dollars (prix réellement payés, remises comprises).
    'by_plan', (
      select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'interval', billing_interval, 'phase', phase, 'provider', provider, 'count', n, 'mrr_usd', mrr_usd)), '[]'::jsonb)
      from (
        select plan, billing_interval, provider, public.subscription_phase(status, trial_ends_at) as phase, count(*) as n, coalesce(sum(monthly_usd), 0) as mrr_usd
        from public.subscriptions
        group by 1, 2, 3, 4
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

create or replace function public.admin_user_detail(p_user uuid) returns jsonb
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
              'provider', s.provider,
              'currency', s.currency,
              'country', s.country,
              'monthly_usd', s.monthly_usd,
              'grace_ends_at', s.grace_ends_at,
              'gift_note', s.gift_note,
              'effective_plan', public.subscription_effective_plan(s.plan, s.status, s.trial_ends_at, s.current_period_end, s.grace_ends_at),
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
