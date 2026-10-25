-- Émulation minimale de ce que Supabase fournit avant nos migrations.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz
);
-- Sessions de Supabase Auth : l'espace propriétaire les supprime pour déconnecter un compte suspendu.
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant select on auth.users to service_role;

create publication supabase_realtime;

-- Supabase range ses extensions dans le schéma « extensions ». PGlite seul n'embarque pas pgvector : le harness remplace le type `vector` des migrations par
-- `real[]` (voir `emulatePgvector` dans harness.ts) et l'opérateur de distance cosinus `<=>` par celui-ci. Cela vérifie notre SQL (droits, plafonds,
-- fusion des rangs). Les mêmes tests de recherche ont aussi été rejoués une fois contre le vrai pgvector (module `@electric-sql/pglite-pgvector`, hors dépôt) ;
-- ce que ni l'un ni l'autre ne couvre : PostgREST et un projet Supabase hébergé.
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create function extensions.cosine_distance(a real[], b real[]) returns float8
language sql immutable as $$
  select 1 - sum(x::float8 * y::float8) / nullif(sqrt(sum(x::float8 * x::float8)) * sqrt(sum(y::float8 * y::float8)), 0)
  from unnest(a, b) as t(x, y)
$$;
create operator extensions.<=> (leftarg = real[], rightarg = real[], function = extensions.cosine_distance);
