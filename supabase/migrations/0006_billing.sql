-- ===========================================================================
-- 0006 — Faturamento: catalogo de planos (global), assinaturas por tenant,
-- registro de uso e faturas.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'billing_interval' and n.nspname = 'billing') then
    create type billing.billing_interval as enum ('month', 'year');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'subscription_status' and n.nspname = 'billing') then
    create type billing.subscription_status as enum
      ('trialing', 'active', 'past_due', 'cancelled');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'invoice_status' and n.nspname = 'billing') then
    create type billing.invoice_status as enum ('draft', 'open', 'paid', 'void');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Planos: catalogo global, igual para todos os tenants
-- ---------------------------------------------------------------------------
create table if not exists billing.plans (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  description  text not null default '',
  price_cents  bigint not null,
  currency     char(3) not null default 'BRL',
  interval     billing.billing_interval not null default 'month',
  trial_days   integer not null default 0,
  features     jsonb not null default '[]'::jsonb,
  limits       jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  position     integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint plans_code_format check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint plans_price_non_negative check (price_cents >= 0),
  constraint plans_trial_non_negative check (trial_days >= 0)
);

drop trigger if exists plans_touch on billing.plans;
create trigger plans_touch before update on billing.plans
  for each row execute function core.touch_updated_at();

-- Catalogo publico: qualquer usuario autenticado le, ninguem escreve pela API
alter table billing.plans enable row level security;
drop policy if exists plans_rls_select on billing.plans;
create policy plans_rls_select on billing.plans
  for select to authenticated, anon using (true);

grant select on billing.plans to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Assinaturas: no maximo uma vigente por tenant
-- ---------------------------------------------------------------------------
create table if not exists billing.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references core.tenants (id) on delete cascade,
  plan_id               uuid not null references billing.plans (id),
  status                billing.subscription_status not null default 'trialing',
  current_period_start  timestamptz not null default now(),
  current_period_end    timestamptz not null,
  trial_ends_at         timestamptz,
  cancel_at_period_end  boolean not null default false,
  cancelled_at          timestamptz,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint subscriptions_period_ordered check (current_period_end > current_period_start),
  constraint subscriptions_cancel_consistency check (
    (status = 'cancelled') = (cancelled_at is not null)
  )
);

create unique index if not exists subscriptions_one_live_per_tenant
  on billing.subscriptions (tenant_id)
  where status in ('trialing', 'active', 'past_due');
create index if not exists subscriptions_tenant_idx on billing.subscriptions (tenant_id, created_at desc);

drop trigger if exists subscriptions_touch on billing.subscriptions;
create trigger subscriptions_touch before update on billing.subscriptions
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Uso medido, acumulado por metrica dentro do periodo
-- ---------------------------------------------------------------------------
create table if not exists billing.usage_records (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references core.tenants (id) on delete cascade,
  subscription_id  uuid references billing.subscriptions (id) on delete cascade,
  metric           text not null,
  quantity         numeric(18, 4) not null,
  recorded_at      timestamptz not null default now(),
  idempotency_key  text,
  metadata         jsonb not null default '{}'::jsonb,
  created_by       uuid,
  constraint usage_records_metric_format check (metric ~ '^[a-z][a-z0-9_.]{1,40}$'),
  constraint usage_records_quantity_positive check (quantity > 0)
);

create index if not exists usage_records_tenant_idx
  on billing.usage_records (tenant_id, metric, recorded_at desc);
create unique index if not exists usage_records_idempotency_key
  on billing.usage_records (tenant_id, idempotency_key) where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Faturas e suas linhas
-- ---------------------------------------------------------------------------
create table if not exists billing.invoice_counters (
  tenant_id    uuid primary key references core.tenants (id) on delete cascade,
  last_number  bigint not null default 0
);

create table if not exists billing.invoices (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references core.tenants (id) on delete cascade,
  subscription_id  uuid references billing.subscriptions (id) on delete set null,
  number           text not null,
  status           billing.invoice_status not null default 'draft',
  currency         char(3) not null default 'BRL',
  subtotal_cents   bigint not null default 0,
  tax_cents        bigint not null default 0,
  total_cents      bigint not null default 0,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  issued_at        timestamptz,
  due_at           timestamptz,
  paid_at          timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, number),
  constraint invoices_period_ordered check (period_end > period_start),
  constraint invoices_totals_non_negative check (
    subtotal_cents >= 0 and tax_cents >= 0 and total_cents >= 0
  ),
  constraint invoices_paid_consistency check ((status = 'paid') = (paid_at is not null))
);

create index if not exists invoices_tenant_idx on billing.invoices (tenant_id, created_at desc);
create index if not exists invoices_status_idx on billing.invoices (tenant_id, status);

drop trigger if exists invoices_touch on billing.invoices;
create trigger invoices_touch before update on billing.invoices
  for each row execute function core.touch_updated_at();

create table if not exists billing.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references core.tenants (id) on delete cascade,
  invoice_id   uuid not null references billing.invoices (id) on delete cascade,
  description  text not null,
  quantity     numeric(18, 4) not null default 1,
  unit_cents   bigint not null,
  total_cents  bigint not null,
  metadata     jsonb not null default '{}'::jsonb,
  position     integer not null default 1,
  constraint invoice_lines_description_not_blank check (length(btrim(description)) between 1 and 240),
  constraint invoice_lines_quantity_positive check (quantity > 0)
);

create index if not exists invoice_lines_invoice_idx on billing.invoice_lines (invoice_id, position);

-- ---------------------------------------------------------------------------
-- Numeracao sequencial de faturas por tenant
-- ---------------------------------------------------------------------------
create or replace function billing.next_invoice_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = billing, public
as $$
declare
  seq bigint;
begin
  insert into billing.invoice_counters (tenant_id, last_number)
  values (p_tenant, 1)
  on conflict (tenant_id) do update set last_number = billing.invoice_counters.last_number + 1
  returning last_number into seq;

  return to_char(now(), 'YYYY') || '-' || lpad(seq::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Consumo real do tenant, usado pelo PlanLimitPolicy do modulo billing.
-- Le tabelas de outros modulos, por isso e security definer e recebe o tenant
-- explicitamente; e a unica porta de leitura cruzada do sistema.
-- ---------------------------------------------------------------------------
create or replace function billing.tenant_usage_snapshot(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = billing, core, crm, projects, public
as $$
  select jsonb_build_object(
    'users',    (select count(*) from core.memberships m where m.tenant_id = p_tenant and m.status = 'active'),
    'projects', (select count(*) from projects.projects p where p.tenant_id = p_tenant and p.status <> 'archived'),
    'deals',    (select count(*) from crm.deals d where d.tenant_id = p_tenant and d.status = 'open'),
    'contacts', (select count(*) from crm.contacts c where c.tenant_id = p_tenant)
  )
$$;

grant execute on function billing.next_invoice_number(uuid), billing.tenant_usage_snapshot(uuid)
  to authenticated, service_role;
