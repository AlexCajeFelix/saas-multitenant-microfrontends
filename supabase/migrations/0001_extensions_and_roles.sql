-- ===========================================================================
-- 0001 — Extensoes, schemas dos modulos e privilegios padrao.
--
-- Roda igual no Supabase (nuvem e `supabase start`) e no stack do docker
-- compose. O que so existe no Postgres cru do compose — papeis da API, o login
-- proprio do PostgREST e os helpers auth.uid()/auth.jwt() — mora em
-- docker/db/bootstrap.sql, que o migrate.sh aplica antes das migrations. No
-- Supabase gerenciado esses objetos ja existem e pertencem a papeis reservados;
-- tentar recria-los aqui quebraria o deploy.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Schemas: um por modulo (modular monolith espalhado em Edge Functions)
-- ---------------------------------------------------------------------------
create schema if not exists core;      -- tenancy: tenants, membros, convites, auditoria
create schema if not exists iam;       -- papeis, permissoes, chaves de API
create schema if not exists crm;       -- empresas, contatos, negocios
create schema if not exists projects;  -- projetos, tarefas, apontamento de horas
create schema if not exists billing;   -- planos, assinaturas, faturas, uso

do $$
declare
  s text;
begin
  foreach s in array array['core', 'iam', 'crm', 'projects', 'billing'] loop
    execute format('grant usage on schema %I to anon, authenticated, service_role', s);
    execute format(
      'alter default privileges in schema %I grant select, insert, update, delete on tables to authenticated, service_role',
      s
    );
    execute format(
      'alter default privileges in schema %I grant usage, select on sequences to authenticated, service_role',
      s
    );
    execute format(
      'alter default privileges in schema %I grant execute on functions to anon, authenticated, service_role',
      s
    );
  end loop;
end $$;

grant usage on schema public to anon, authenticated, service_role;
