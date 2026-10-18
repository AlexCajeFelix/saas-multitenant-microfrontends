-- ===========================================================================
-- RLS por consulta, nao por linha.
--
-- As politicas de enable_tenant_rls chamavam core.has_permission(tenant_id,
-- ...) em cada linha. Com volume isso nao fecha: contar os 20 mil contatos de
-- um tenant levava 8,2 s no dev (20 mil chamadas), acima dos 8 s de
-- statement_timeout do papel authenticated, e toda listagem dava 500.
--
-- Agora a politica pergunta uma vez por consulta em quais tenants o usuario
-- tem a permissao (core.permitted_tenants, poucos ids) e cada linha so confere
-- se o tenant dela esta na lista: 8,2 s -> 20 ms na mesma contagem.
--
-- A regra e a mesma: permitted_tenants devolve os tenants em que o usuario e
-- membro ativo e has_permission responde sim, e has_permission so responde sim
-- para membro ativo. As politicas proprias do IAM (roles, role_permissions)
-- continuam linha a linha: sao tabelas pequenas.
-- ===========================================================================

create or replace function core.permitted_tenants(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = core, iam, public
as $$
  select m.tenant_id
  from core.memberships m
  where m.user_id = auth.uid()
    and m.status = 'active'
    and core.has_permission(m.tenant_id, p_permission, m.user_id)
$$;

grant execute on function core.permitted_tenants(text) to authenticated, service_role;

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
  can_read  text := format('%s in (select core.permitted_tenants(%L))', col, p_read_perm);
  can_write text := format('%s in (select core.permitted_tenants(%L))', col, p_write_perm);
begin
  execute format('alter table %s enable row level security', qualified);
  execute format('alter table %s force row level security', qualified);

  execute format('drop policy if exists %I on %s', p_table || '_rls_select', qualified);
  execute format('drop policy if exists %I on %s', p_table || '_rls_insert', qualified);
  execute format('drop policy if exists %I on %s', p_table || '_rls_update', qualified);
  execute format('drop policy if exists %I on %s', p_table || '_rls_delete', qualified);

  execute format('create policy %I on %s for select to authenticated using (%s)',
    p_table || '_rls_select', qualified, can_read);
  execute format('create policy %I on %s for insert to authenticated with check (%s)',
    p_table || '_rls_insert', qualified, can_write);
  execute format('create policy %I on %s for update to authenticated using (%s) with check (%s)',
    p_table || '_rls_update', qualified, can_write, can_write);
  execute format('create policy %I on %s for delete to authenticated using (%s)',
    p_table || '_rls_delete', qualified, can_write);
end;
$$;

-- As mesmas chamadas de 0008_rls_policies.sql, que recriam as politicas.
select core.enable_tenant_rls('core', 'tenants',       'tenancy.tenant.read',     'tenancy.tenant.write', 'id');
select core.enable_tenant_rls('core', 'memberships',   'tenancy.member.read',     'tenancy.member.write');
select core.enable_tenant_rls('core', 'invitations',   'tenancy.invitation.read', 'tenancy.invitation.write');
select core.enable_tenant_rls('core', 'audit_logs',    'tenancy.audit.read',      'tenancy.tenant.write');
select core.enable_tenant_rls('core', 'domain_events', 'tenancy.audit.read',      'tenancy.tenant.write');

select core.enable_tenant_rls('iam', 'api_keys', 'iam.api_key.read', 'iam.api_key.write');

select core.enable_tenant_rls('crm', 'pipeline_stages', 'crm.pipeline.read', 'crm.pipeline.write');
select core.enable_tenant_rls('crm', 'companies',       'crm.company.read',  'crm.company.write');
select core.enable_tenant_rls('crm', 'contacts',        'crm.contact.read',  'crm.contact.write');
select core.enable_tenant_rls('crm', 'deals',           'crm.deal.read',     'crm.deal.write');
select core.enable_tenant_rls('crm', 'activities',      'crm.activity.read', 'crm.activity.write');

select core.enable_tenant_rls('projects', 'projects',      'projects.project.read',    'projects.project.write');
select core.enable_tenant_rls('projects', 'milestones',    'projects.project.read',    'projects.milestone.write');
select core.enable_tenant_rls('projects', 'tasks',         'projects.task.read',       'projects.task.write');
select core.enable_tenant_rls('projects', 'task_comments', 'projects.task.read',       'projects.comment.write');
select core.enable_tenant_rls('projects', 'time_entries',  'projects.time_entry.read', 'projects.time_entry.write');

select core.enable_tenant_rls('billing', 'subscriptions', 'billing.subscription.read', 'billing.subscription.write');
select core.enable_tenant_rls('billing', 'usage_records', 'billing.usage.read',        'billing.usage.write');
select core.enable_tenant_rls('billing', 'invoices',      'billing.invoice.read',      'billing.invoice.write');
select core.enable_tenant_rls('billing', 'invoice_lines', 'billing.invoice.read',      'billing.invoice.write');
