-- ===========================================================================
-- Bootstrap do stack local (docker compose). NAO e migration.
--
-- A imagem supabase/postgres sozinha, sem a plataforma, nao traz tudo que o
-- Supabase gerenciado traz. Este arquivo cobre a diferenca e roda antes das
-- migrations (docker/db/migrate.sh). No Supabase de verdade (nuvem ou
-- `supabase start`) nada disto e necessario.
-- ===========================================================================

create schema if not exists auth;      -- gerenciado pelo GoTrue; criado aqui so por seguranca

-- ---------------------------------------------------------------------------
-- Papeis usados por PostgREST e GoTrue.
--
-- A imagem supabase/postgres ja traz anon, authenticated, service_role e
-- authenticator, e os protege: nem o usuario `postgres` consegue alterar um
-- papel reservado. Por isso o login do PostgREST e um papel proprio,
-- `app_authenticator`, que criamos e cuja senha controlamos. Ele nao tem
-- BYPASSRLS: e essa a diferenca que faz a RLS valer de verdade.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- service_role precisa furar RLS: e a identidade das operacoes administrativas
-- das Edge Functions (criar tenant, aceitar convite, auditoria, outbox).
-- Na imagem do Supabase ja vem assim e a alteracao e bloqueada; ignoramos.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
    execute 'alter role service_role bypassrls';
  end if;
exception when others then
  raise notice 'service_role ja e gerenciado pela imagem: %', sqlerrm;
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_authenticator') then
    create role app_authenticator login noinherit;
  end if;
end $$;

alter role app_authenticator with login noinherit password :'pgpass';

grant anon, authenticated, service_role to app_authenticator;

do $$
begin
  execute 'grant anon, authenticated, service_role to postgres';
exception when others then
  raise notice 'postgres ja pertence aos papeis da API: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers de autenticacao (o PostgREST publica as claims do JWT em GUCs)
-- ---------------------------------------------------------------------------
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      auth.jwt() ->> 'sub'
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt() ->> 'role',
    'anon'
  )
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role()
  to anon, authenticated, service_role;
