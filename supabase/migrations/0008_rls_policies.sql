-- ===========================================================================
-- 0008 — RLS em todas as tabelas de negocio.
-- Esta e a fronteira real do multi-tenant: mesmo que uma Edge Function esqueca
-- o filtro por tenant_id, o Postgres nao devolve linha de outro tenant.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Nucleo. A tabela de tenants usa a propria coluna id como discriminador.
-- ---------------------------------------------------------------------------
select core.enable_tenant_rls('core', 'tenants',       'tenancy.tenant.read',     'tenancy.tenant.write', 'id');
select core.enable_tenant_rls('core', 'memberships',   'tenancy.member.read',     'tenancy.member.write');
select core.enable_tenant_rls('core', 'invitations',   'tenancy.invitation.read', 'tenancy.invitation.write');
select core.enable_tenant_rls('core', 'audit_logs',    'tenancy.audit.read',      'tenancy.tenant.write');
select core.enable_tenant_rls('core', 'domain_events', 'tenancy.audit.read',      'tenancy.tenant.write');

-- ---------------------------------------------------------------------------
-- IAM. Papeis de sistema tem tenant_id nulo e precisam de politicas proprias.
-- ---------------------------------------------------------------------------
create or replace function iam.role_readable(p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = iam, core, public
as $$
  select exists (
    select 1 from iam.roles r
    where r.id = p_role
      and (
        core.has_permission(r.tenant_id, 'iam.role.read')
        or (r.tenant_id is null and core.has_permission(core.current_tenant_id(), 'iam.role.read'))
      )
  )
$$;

create or replace function iam.role_manageable(p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = iam, core, public
as $$
  select exists (
    select 1 from iam.roles r
    where r.id = p_role
      and r.tenant_id is not null
      and r.is_system = false
      and core.has_permission(r.tenant_id, 'iam.role.write')
  )
$$;

grant execute on function iam.role_readable(uuid), iam.role_manageable(uuid)
  to authenticated, service_role;

-- Catalogo de permissoes: leitura livre para quem esta autenticado
alter table iam.permissions enable row level security;
drop policy if exists permissions_rls_select on iam.permissions;
create policy permissions_rls_select on iam.permissions
  for select to authenticated using (true);

alter table iam.roles enable row level security;
alter table iam.roles force row level security;
drop policy if exists roles_rls_select on iam.roles;
drop policy if exists roles_rls_insert on iam.roles;
drop policy if exists roles_rls_update on iam.roles;
drop policy if exists roles_rls_delete on iam.roles;

create policy roles_rls_select on iam.roles for select to authenticated using (
  core.has_permission(tenant_id, 'iam.role.read')
  or (tenant_id is null and core.has_permission(core.current_tenant_id(), 'iam.role.read'))
);
create policy roles_rls_insert on iam.roles for insert to authenticated with check (
  tenant_id is not null and is_system = false and core.has_permission(tenant_id, 'iam.role.write')
);
create policy roles_rls_update on iam.roles for update to authenticated
  using (tenant_id is not null and is_system = false and core.has_permission(tenant_id, 'iam.role.write'))
  with check (tenant_id is not null and is_system = false and core.has_permission(tenant_id, 'iam.role.write'));
create policy roles_rls_delete on iam.roles for delete to authenticated using (
  tenant_id is not null and is_system = false and core.has_permission(tenant_id, 'iam.role.write')
);

alter table iam.role_permissions enable row level security;
alter table iam.role_permissions force row level security;
drop policy if exists role_permissions_rls_select on iam.role_permissions;
drop policy if exists role_permissions_rls_insert on iam.role_permissions;
drop policy if exists role_permissions_rls_delete on iam.role_permissions;

create policy role_permissions_rls_select on iam.role_permissions
  for select to authenticated using (iam.role_readable(role_id));
create policy role_permissions_rls_insert on iam.role_permissions
  for insert to authenticated with check (iam.role_manageable(role_id));
create policy role_permissions_rls_delete on iam.role_permissions
  for delete to authenticated using (iam.role_manageable(role_id));

select core.enable_tenant_rls('iam', 'api_keys', 'iam.api_key.read', 'iam.api_key.write');

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
select core.enable_tenant_rls('crm', 'pipeline_stages', 'crm.pipeline.read', 'crm.pipeline.write');
select core.enable_tenant_rls('crm', 'companies',       'crm.company.read',  'crm.company.write');
select core.enable_tenant_rls('crm', 'contacts',        'crm.contact.read',  'crm.contact.write');
select core.enable_tenant_rls('crm', 'deals',           'crm.deal.read',     'crm.deal.write');
select core.enable_tenant_rls('crm', 'activities',      'crm.activity.read', 'crm.activity.write');

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------
select core.enable_tenant_rls('projects', 'projects',      'projects.project.read',    'projects.project.write');
select core.enable_tenant_rls('projects', 'milestones',    'projects.project.read',    'projects.milestone.write');
select core.enable_tenant_rls('projects', 'tasks',         'projects.task.read',       'projects.task.write');
select core.enable_tenant_rls('projects', 'task_comments', 'projects.task.read',       'projects.comment.write');
select core.enable_tenant_rls('projects', 'time_entries',  'projects.time_entry.read', 'projects.time_entry.write');

-- ---------------------------------------------------------------------------
-- Faturamento (billing.plans ja tratado na 0006)
-- ---------------------------------------------------------------------------
select core.enable_tenant_rls('billing', 'subscriptions', 'billing.subscription.read', 'billing.subscription.write');
select core.enable_tenant_rls('billing', 'usage_records', 'billing.usage.read',        'billing.usage.write');
select core.enable_tenant_rls('billing', 'invoices',      'billing.invoice.read',      'billing.invoice.write');
select core.enable_tenant_rls('billing', 'invoice_lines', 'billing.invoice.read',      'billing.invoice.write');

-- Contador de faturas: so o service_role toca (que ja passa por cima da RLS)
alter table billing.invoice_counters enable row level security;
alter table billing.invoice_counters force row level security;

-- ---------------------------------------------------------------------------
-- Concessoes. A RLS decide quais linhas; o grant decide quais tabelas.
-- ---------------------------------------------------------------------------
do $$
declare
  s text;
begin
  foreach s in array array['core', 'iam', 'crm', 'projects', 'billing'] loop
    execute format('grant select, insert, update, delete on all tables in schema %I to authenticated, service_role', s);
    execute format('grant usage, select on all sequences in schema %I to authenticated, service_role', s);
  end loop;
end $$;

revoke insert, update, delete on billing.plans from authenticated;
revoke insert, update, delete on iam.permissions from authenticated;
