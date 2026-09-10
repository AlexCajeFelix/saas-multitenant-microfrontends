-- ===========================================================================
-- 0002 — Nucleo multi-tenant: tenants, membros, convites, auditoria e outbox.
-- Tambem define a maquinaria generica de RLS usada por todos os modulos.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Gatilho de updated_at, reaproveitado por todas as tabelas
-- ---------------------------------------------------------------------------
create or replace function core.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'tenant_status' and n.nspname = 'core') then
    create type core.tenant_status as enum ('active', 'suspended', 'cancelled');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'membership_status' and n.nspname = 'core') then
    create type core.membership_status as enum ('active', 'revoked');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'invitation_status' and n.nspname = 'core') then
    create type core.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create table if not exists core.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  name        text not null,
  status      core.tenant_status not null default 'active',
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$'),
  constraint tenants_name_not_blank check (length(btrim(name)) between 2 and 120)
);

create unique index if not exists tenants_slug_key on core.tenants (lower(slug));

drop trigger if exists tenants_touch on core.tenants;
create trigger tenants_touch before update on core.tenants
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Membros: liga um usuario do GoTrue a um tenant, com um papel
-- ---------------------------------------------------------------------------
create table if not exists core.memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references core.tenants (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role_slug   text not null default 'member',
  status      core.membership_status not null default 'active',
  invited_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists memberships_user_idx on core.memberships (user_id) where status = 'active';
create index if not exists memberships_tenant_idx on core.memberships (tenant_id, status);

drop trigger if exists memberships_touch on core.memberships;
create trigger memberships_touch before update on core.memberships
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Convites: o token viaja por e-mail, no banco fica so o hash
-- ---------------------------------------------------------------------------
create table if not exists core.invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references core.tenants (id) on delete cascade,
  email        text not null,
  role_slug    text not null default 'member',
  token_hash   text not null unique,
  status       core.invitation_status not null default 'pending',
  invited_by   uuid,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint invitations_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create unique index if not exists invitations_pending_key
  on core.invitations (tenant_id, lower(email)) where status = 'pending';
create index if not exists invitations_tenant_idx on core.invitations (tenant_id, status);

drop trigger if exists invitations_touch on core.invitations;
create trigger invitations_touch before update on core.invitations
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Trilha de auditoria (escrita sempre com service_role)
-- ---------------------------------------------------------------------------
create table if not exists core.audit_logs (
  id             bigserial primary key,
  tenant_id      uuid references core.tenants (id) on delete cascade,
  actor_id       uuid,
  module         text not null,
  action         text not null,
  resource_type  text not null,
  resource_id    text,
  metadata       jsonb not null default '{}'::jsonb,
  request_id     text,
  created_at     timestamptz not null default now()
);

create index if not exists audit_logs_tenant_idx on core.audit_logs (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Outbox de eventos de dominio: os agregados enfileiram, o publisher grava aqui
-- ---------------------------------------------------------------------------
create table if not exists core.domain_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references core.tenants (id) on delete cascade,
  aggregate_type  text not null,
  aggregate_id    text not null,
  event_name      text not null,
  payload         jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  published_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists domain_events_unpublished_idx
  on core.domain_events (occurred_at) where published_at is null;
create index if not exists domain_events_tenant_idx
  on core.domain_events (tenant_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Contexto de requisicao: qual tenant o chamador declarou
-- ---------------------------------------------------------------------------
create or replace function core.request_headers()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
$$;

create or replace function core.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      core.request_headers() ->> 'x-tenant-id',
      auth.jwt() ->> 'tenant_id'
    ),
    ''
  )::uuid
$$;

-- Security definer para nao entrar em recursao de RLS ao consultar memberships
create or replace function core.is_member(p_tenant uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = p_user
      and m.status = 'active'
  )
$$;

create or replace function core.member_role(p_tenant uuid, p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = core, public
as $$
  select m.role_slug
  from core.memberships m
  where m.tenant_id = p_tenant
    and m.user_id = p_user
    and m.status = 'active'
  limit 1
$$;

grant execute on function
  core.request_headers(),
  core.current_tenant_id(),
  core.is_member(uuid, uuid),
  core.member_role(uuid, uuid)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fabrica de politicas de RLS por tenant.
-- Toda tabela de negocio recebe as mesmas quatro politicas, diferindo apenas
-- nas permissoes exigidas para ler e para escrever.
-- ---------------------------------------------------------------------------
create or replace function core.enable_tenant_rls(
  p_schema        text,
  p_table         text,
  p_read_perm     text,
  p_write_perm    text,
  p_tenant_column text default 'tenant_id'
)
returns void
language plpgsql
as $$
declare
  qualified text := format('%I.%I', p_schema, p_table);
  col       text := quote_ident(p_tenant_column);
begin
  execute format('alter table %s enable row level security', qualified);
  execute format('alter table %s force row level security', qualified);

  execute format('drop policy if exists %I on %s', p_table || '_rls_select', qualified);
  execute format('drop policy if exists %I on %s', p_table || '_rls_insert', qualified);
  execute format('drop policy if exists %I on %s', p_table || '_rls_update', qualified);
  execute format('drop policy if exists %I on %s', p_table || '_rls_delete', qualified);

  execute format(
    'create policy %I on %s for select to authenticated using (core.has_permission(%s, %L))',
    p_table || '_rls_select', qualified, col, p_read_perm
  );
  execute format(
    'create policy %I on %s for insert to authenticated with check (core.has_permission(%s, %L))',
    p_table || '_rls_insert', qualified, col, p_write_perm
  );
  execute format(
    'create policy %I on %s for update to authenticated using (core.has_permission(%s, %L)) with check (core.has_permission(%s, %L))',
    p_table || '_rls_update', qualified, col, p_write_perm, col, p_write_perm
  );
  execute format(
    'create policy %I on %s for delete to authenticated using (core.has_permission(%s, %L))',
    p_table || '_rls_delete', qualified, col, p_write_perm
  );
end;
$$;
