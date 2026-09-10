-- ===========================================================================
-- 0004 — CRM: empresas, contatos, funil de vendas, negocios e atividades.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'deal_status' and n.nspname = 'crm') then
    create type crm.deal_status as enum ('open', 'won', 'lost');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'activity_kind' and n.nspname = 'crm') then
    create type crm.activity_kind as enum ('call', 'email', 'meeting', 'note', 'task');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Funil: cada tenant define seus proprios estagios
-- ---------------------------------------------------------------------------
create table if not exists crm.pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references core.tenants (id) on delete cascade,
  key          text not null,
  name         text not null,
  position     integer not null,
  probability  integer not null default 0,
  is_won       boolean not null default false,
  is_lost      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, key),
  constraint pipeline_stages_probability_range check (probability between 0 and 100),
  constraint pipeline_stages_key_format check (key ~ '^[a-z][a-z0-9_]{1,30}$')
);

create index if not exists pipeline_stages_tenant_idx on crm.pipeline_stages (tenant_id, position);

drop trigger if exists pipeline_stages_touch on crm.pipeline_stages;
create trigger pipeline_stages_touch before update on crm.pipeline_stages
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------------
create table if not exists crm.companies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references core.tenants (id) on delete cascade,
  name        text not null,
  domain      text,
  industry    text,
  size        text,
  website     text,
  phone       text,
  address     jsonb not null default '{}'::jsonb,
  owner_id    uuid,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint companies_name_not_blank check (length(btrim(name)) between 1 and 160)
);

create index if not exists companies_tenant_idx on crm.companies (tenant_id, created_at desc);
create index if not exists companies_name_idx on crm.companies (tenant_id, lower(name));
create unique index if not exists companies_domain_key
  on crm.companies (tenant_id, lower(domain)) where domain is not null;

drop trigger if exists companies_touch on crm.companies;
create trigger companies_touch before update on crm.companies
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Contatos
-- ---------------------------------------------------------------------------
create table if not exists crm.contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references core.tenants (id) on delete cascade,
  company_id  uuid references crm.companies (id) on delete set null,
  first_name  text not null,
  last_name   text not null default '',
  email       text,
  phone       text,
  job_title   text,
  owner_id    uuid,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint contacts_first_name_not_blank check (length(btrim(first_name)) between 1 and 80),
  constraint contacts_email_format check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index if not exists contacts_tenant_idx on crm.contacts (tenant_id, created_at desc);
create index if not exists contacts_company_idx on crm.contacts (company_id);
create unique index if not exists contacts_email_key
  on crm.contacts (tenant_id, lower(email)) where email is not null;

drop trigger if exists contacts_touch on crm.contacts;
create trigger contacts_touch before update on crm.contacts
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Negocios
-- ---------------------------------------------------------------------------
create table if not exists crm.deals (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references core.tenants (id) on delete cascade,
  title                text not null,
  company_id           uuid references crm.companies (id) on delete set null,
  contact_id           uuid references crm.contacts (id) on delete set null,
  stage_key            text not null,
  status               crm.deal_status not null default 'open',
  amount_cents         bigint not null default 0,
  currency             char(3) not null default 'BRL',
  probability          integer not null default 0,
  expected_close_date  date,
  closed_at            timestamptz,
  lost_reason          text,
  owner_id             uuid,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint deals_title_not_blank check (length(btrim(title)) between 2 and 160),
  constraint deals_amount_non_negative check (amount_cents >= 0),
  constraint deals_probability_range check (probability between 0 and 100),
  constraint deals_closed_consistency check (
    (status = 'open' and closed_at is null) or (status <> 'open' and closed_at is not null)
  )
);

create index if not exists deals_tenant_idx on crm.deals (tenant_id, created_at desc);
create index if not exists deals_stage_idx on crm.deals (tenant_id, stage_key) where status = 'open';
create index if not exists deals_company_idx on crm.deals (company_id);

drop trigger if exists deals_touch on crm.deals;
create trigger deals_touch before update on crm.deals
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Atividades: entidade filha do agregado Deal
-- ---------------------------------------------------------------------------
create table if not exists crm.activities (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references core.tenants (id) on delete cascade,
  deal_id      uuid not null references crm.deals (id) on delete cascade,
  kind         crm.activity_kind not null,
  subject      text not null,
  notes        text not null default '',
  occurred_at  timestamptz not null default now(),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  constraint activities_subject_not_blank check (length(btrim(subject)) between 2 and 160)
);

create index if not exists activities_deal_idx on crm.activities (deal_id, occurred_at desc);
create index if not exists activities_tenant_idx on crm.activities (tenant_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Estagios padrao criados junto com o tenant
-- ---------------------------------------------------------------------------
create or replace function crm.install_default_pipeline(p_tenant uuid)
returns void
language sql
security definer
set search_path = crm, public
as $$
  insert into crm.pipeline_stages (tenant_id, key, name, position, probability, is_won, is_lost)
  values
    (p_tenant, 'lead',        'Lead',          1,  10, false, false),
    (p_tenant, 'qualified',   'Qualificado',   2,  30, false, false),
    (p_tenant, 'proposal',    'Proposta',      3,  60, false, false),
    (p_tenant, 'negotiation', 'Negociacao',    4,  80, false, false),
    (p_tenant, 'won',         'Ganho',         5, 100, true,  false),
    (p_tenant, 'lost',        'Perdido',       6,   0, false, true)
  on conflict (tenant_id, key) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Resumo do funil. security invoker: a RLS do chamador continua valendo.
-- ---------------------------------------------------------------------------
create or replace function crm.pipeline_summary(p_tenant uuid)
returns table (
  stage_key       text,
  stage_name      text,
  stage_position  integer,
  deals_count     bigint,
  total_cents     bigint,
  weighted_cents  bigint
)
language sql
stable
as $$
  select
    s.key,
    s.name,
    s.position,
    count(d.id),
    coalesce(sum(d.amount_cents), 0)::bigint,
    coalesce(sum(d.amount_cents * s.probability / 100), 0)::bigint
  from crm.pipeline_stages s
  left join crm.deals d
    on d.stage_key = s.key
   and d.tenant_id = s.tenant_id
   and d.status = 'open'
  where s.tenant_id = p_tenant
  group by s.key, s.name, s.position
  order by s.position
$$;

grant execute on function crm.install_default_pipeline(uuid), crm.pipeline_summary(uuid)
  to authenticated, service_role;
