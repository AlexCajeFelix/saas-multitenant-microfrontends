-- ===========================================================================
-- Seed de demonstracao: dois tenants com dados nos cinco modulos.
--
-- Recebe os ids dos usuarios ja criados no GoTrue, via psql:
--   -v owner_a=... -v member_a=... -v owner_b=... -v member_b=...
--
-- Reexecutavel: apaga os dois tenants de demonstracao antes de recriar, e o
-- cascata leva junto tudo que pertence a eles.
-- ===========================================================================

\set acme   '11111111-aaaa-4aaa-8aaa-000000000001'
\set globex '22222222-bbbb-4bbb-8bbb-000000000002'

delete from core.tenants where slug in ('acme', 'globex');

-- ---------------------------------------------------------------------------
-- Tenants e membros
-- ---------------------------------------------------------------------------
insert into core.tenants (id, slug, name, status, settings, created_by) values
  (:'acme'::uuid,   'acme',   'Acme Industrias',   'active',
   '{"locale":"pt-BR","timezone":"America/Sao_Paulo"}'::jsonb, :'owner_a'::uuid),
  (:'globex'::uuid, 'globex', 'Globex Corporation', 'active',
   '{"locale":"pt-BR","timezone":"America/Sao_Paulo"}'::jsonb, :'owner_b'::uuid);

insert into core.memberships (tenant_id, user_id, role_slug, status) values
  (:'acme'::uuid,   :'owner_a'::uuid,  'owner',   'active'),
  (:'acme'::uuid,   :'member_a'::uuid, 'manager', 'active'),
  (:'globex'::uuid, :'owner_b'::uuid,  'owner',   'active'),
  (:'globex'::uuid, :'member_b'::uuid, 'member',  'active');

select crm.install_default_pipeline(:'acme'::uuid);
select crm.install_default_pipeline(:'globex'::uuid);

-- Um papel proprio do tenant Acme, para exercitar o IAM
insert into iam.roles (id, tenant_id, slug, name, description, is_system) values
  ('33333333-cccc-4ccc-8ccc-000000000003', :'acme'::uuid, 'vendedor', 'Vendedor',
   'Opera apenas o funil de vendas', false);

insert into iam.role_permissions (role_id, permission_slug)
select '33333333-cccc-4ccc-8ccc-000000000003', slug
from iam.permissions
where slug in (
  'crm.company.read', 'crm.contact.read', 'crm.contact.write',
  'crm.deal.read', 'crm.deal.write', 'crm.activity.write', 'crm.pipeline.read',
  'billing.plan.read'
);

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
insert into crm.companies (id, tenant_id, name, domain, industry, size, owner_id, created_by) values
  ('44444444-0001-4000-8000-000000000001', :'acme'::uuid, 'Padaria Sol Nascente', 'solnascente.com.br', 'Alimentos', '11-50', :'owner_a'::uuid, :'owner_a'::uuid),
  ('44444444-0001-4000-8000-000000000002', :'acme'::uuid, 'Transportes Veloz',    'veloz.com.br',       'Logistica', '51-200', :'member_a'::uuid, :'owner_a'::uuid),
  ('44444444-0002-4000-8000-000000000003', :'globex'::uuid, 'Clinica Bem Estar',  'bemestar.com.br',    'Saude',     '11-50', :'owner_b'::uuid, :'owner_b'::uuid);

insert into crm.contacts (id, tenant_id, company_id, first_name, last_name, email, job_title, owner_id, created_by) values
  ('55555555-0001-4000-8000-000000000001', :'acme'::uuid, '44444444-0001-4000-8000-000000000001', 'Marina', 'Duarte', 'marina@solnascente.com.br', 'Proprietaria', :'owner_a'::uuid, :'owner_a'::uuid),
  ('55555555-0001-4000-8000-000000000002', :'acme'::uuid, '44444444-0001-4000-8000-000000000002', 'Rafael', 'Nunes',  'rafael@veloz.com.br',       'Diretor de Operacoes', :'member_a'::uuid, :'owner_a'::uuid),
  ('55555555-0002-4000-8000-000000000003', :'globex'::uuid, '44444444-0002-4000-8000-000000000003', 'Helena', 'Prado', 'helena@bemestar.com.br',  'Gerente', :'owner_b'::uuid, :'owner_b'::uuid);

insert into crm.deals (id, tenant_id, title, company_id, contact_id, stage_key, status, amount_cents, currency, probability, expected_close_date, owner_id, created_by) values
  ('66666666-0001-4000-8000-000000000001', :'acme'::uuid, 'Sistema de PDV',        '44444444-0001-4000-8000-000000000001', '55555555-0001-4000-8000-000000000001', 'proposal',    'open', 1850000, 'BRL', 60, current_date + 30, :'owner_a'::uuid,  :'owner_a'::uuid),
  ('66666666-0001-4000-8000-000000000002', :'acme'::uuid, 'Roteirizacao de frota', '44444444-0001-4000-8000-000000000002', '55555555-0001-4000-8000-000000000002', 'negotiation', 'open', 7400000, 'BRL', 80, current_date + 45, :'member_a'::uuid, :'owner_a'::uuid),
  ('66666666-0001-4000-8000-000000000003', :'acme'::uuid, 'Consultoria inicial',   '44444444-0001-4000-8000-000000000001', '55555555-0001-4000-8000-000000000001', 'lead',        'open',  350000, 'BRL', 10, current_date + 15, :'owner_a'::uuid,  :'owner_a'::uuid),
  ('66666666-0002-4000-8000-000000000004', :'globex'::uuid, 'Prontuario eletronico','44444444-0002-4000-8000-000000000003','55555555-0002-4000-8000-000000000003', 'qualified',   'open', 2900000, 'BRL', 30, current_date + 60, :'owner_b'::uuid,  :'owner_b'::uuid);

insert into crm.activities (tenant_id, deal_id, kind, subject, notes, created_by) values
  (:'acme'::uuid, '66666666-0001-4000-8000-000000000001', 'call',    'Ligacao de qualificacao', 'Cliente confirmou orcamento aprovado para o trimestre', :'owner_a'::uuid),
  (:'acme'::uuid, '66666666-0001-4000-8000-000000000001', 'meeting', 'Demonstracao do produto', 'Apresentada a versao com integracao fiscal',           :'owner_a'::uuid),
  (:'acme'::uuid, '66666666-0001-4000-8000-000000000002', 'email',   'Envio da proposta',       'Proposta comercial revisao 2',                          :'member_a'::uuid);

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------
insert into projects.projects (id, tenant_id, code, name, description, status, start_date, due_date, budget_cents, currency, owner_id, client_company_id, created_by) values
  ('77777777-0001-4000-8000-000000000001', :'acme'::uuid, 'PDV', 'Implantacao do PDV', 'Rollout em 12 lojas', 'active', current_date - 10, current_date + 50, 18500000, 'BRL', :'owner_a'::uuid, '44444444-0001-4000-8000-000000000001', :'owner_a'::uuid),
  ('77777777-0002-4000-8000-000000000002', :'globex'::uuid, 'PRONT', 'Prontuario eletronico', 'Fase de descoberta', 'planning', current_date, current_date + 90, 29000000, 'BRL', :'owner_b'::uuid, '44444444-0002-4000-8000-000000000003', :'owner_b'::uuid);

insert into projects.milestones (id, tenant_id, project_id, name, due_date, position) values
  ('88888888-0001-4000-8000-000000000001', :'acme'::uuid, '77777777-0001-4000-8000-000000000001', 'Piloto em uma loja', current_date + 20, 1),
  ('88888888-0001-4000-8000-000000000002', :'acme'::uuid, '77777777-0001-4000-8000-000000000001', 'Rollout completo',   current_date + 50, 2);

insert into projects.tasks (id, tenant_id, project_id, parent_task_id, milestone_id, title, description, status, priority, assignee_id, estimate_minutes, due_date, completed_at, position, created_by) values
  ('99999999-0001-4000-8000-000000000001', :'acme'::uuid, '77777777-0001-4000-8000-000000000001', null, '88888888-0001-4000-8000-000000000001', 'Levantar requisitos fiscais', 'Mapear NFC-e por estado', 'done',        'high',   :'member_a'::uuid, 480, current_date - 5, now(), 1, :'owner_a'::uuid),
  ('99999999-0001-4000-8000-000000000002', :'acme'::uuid, '77777777-0001-4000-8000-000000000001', null, '88888888-0001-4000-8000-000000000001', 'Configurar impressoras',      'Modelo Epson TM-T20',    'in_progress', 'medium', :'member_a'::uuid, 240, current_date + 3, null,  2, :'owner_a'::uuid),
  ('99999999-0001-4000-8000-000000000003', :'acme'::uuid, '77777777-0001-4000-8000-000000000001', '99999999-0001-4000-8000-000000000002', null, 'Testar impressao de cupom', 'Ambiente de homologacao', 'todo',      'medium', :'member_a'::uuid, 120, current_date + 2, null,  1, :'owner_a'::uuid),
  ('99999999-0001-4000-8000-000000000004', :'acme'::uuid, '77777777-0001-4000-8000-000000000001', null, '88888888-0001-4000-8000-000000000002', 'Treinar equipe das lojas',    'Duas turmas',            'todo',        'urgent', :'owner_a'::uuid,  600, current_date + 40, null, 3, :'owner_a'::uuid);

insert into projects.task_comments (tenant_id, task_id, author_id, body) values
  (:'acme'::uuid, '99999999-0001-4000-8000-000000000001', :'member_a'::uuid, 'Requisitos validados com a contabilidade do cliente.'),
  (:'acme'::uuid, '99999999-0001-4000-8000-000000000002', :'owner_a'::uuid,  'Chegaram duas impressoras a menos; cobrei o fornecedor.');

insert into projects.time_entries (tenant_id, project_id, task_id, user_id, minutes, spent_on, notes) values
  (:'acme'::uuid, '77777777-0001-4000-8000-000000000001', '99999999-0001-4000-8000-000000000001', :'member_a'::uuid, 300, current_date - 6, 'Analise fiscal'),
  (:'acme'::uuid, '77777777-0001-4000-8000-000000000001', '99999999-0001-4000-8000-000000000001', :'member_a'::uuid, 180, current_date - 5, 'Documentacao'),
  (:'acme'::uuid, '77777777-0001-4000-8000-000000000001', '99999999-0001-4000-8000-000000000002', :'member_a'::uuid, 120, current_date - 1, 'Configuracao inicial');

-- ---------------------------------------------------------------------------
-- Faturamento
-- ---------------------------------------------------------------------------
insert into billing.subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, created_by)
select 'aaaaaaaa-0001-4000-8000-000000000001', :'acme'::uuid, p.id, 'active',
       date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', :'owner_a'::uuid
from billing.plans p where p.code = 'pro';

insert into billing.subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, trial_ends_at, created_by)
select 'aaaaaaaa-0002-4000-8000-000000000002', :'globex'::uuid, p.id, 'trialing',
       date_trunc('month', now()), date_trunc('month', now()) + interval '1 month',
       now() + interval '14 days', :'owner_b'::uuid
from billing.plans p where p.code = 'starter';

insert into billing.usage_records (tenant_id, subscription_id, metric, quantity, recorded_at, created_by) values
  (:'acme'::uuid, 'aaaaaaaa-0001-4000-8000-000000000001', 'api.calls',  12500, now() - interval '3 days', :'owner_a'::uuid),
  (:'acme'::uuid, 'aaaaaaaa-0001-4000-8000-000000000001', 'api.calls',   8300, now() - interval '1 day',  :'owner_a'::uuid),
  (:'acme'::uuid, 'aaaaaaaa-0001-4000-8000-000000000001', 'storage.gb',    64, now() - interval '1 day',  :'owner_a'::uuid);

insert into billing.invoices (id, tenant_id, subscription_id, number, status, currency, subtotal_cents, tax_cents, total_cents, period_start, period_end, issued_at, due_at, created_by)
values ('bbbbbbbb-0001-4000-8000-000000000001', :'acme'::uuid, 'aaaaaaaa-0001-4000-8000-000000000001',
        to_char(now(), 'YYYY') || '-000001', 'open', 'BRL', 29900, 1495, 31395,
        date_trunc('month', now()) - interval '1 month', date_trunc('month', now()),
        now() - interval '5 days', now() + interval '10 days', :'owner_a'::uuid);

insert into billing.invoice_counters (tenant_id, last_number) values (:'acme'::uuid, 1)
  on conflict (tenant_id) do update set last_number = greatest(billing.invoice_counters.last_number, 1);

insert into billing.invoice_lines (tenant_id, invoice_id, description, quantity, unit_cents, total_cents, position) values
  (:'acme'::uuid, 'bbbbbbbb-0001-4000-8000-000000000001', 'Assinatura Pro (mensal)', 1, 29900, 29900, 1);

-- ---------------------------------------------------------------------------
-- Resumo
-- ---------------------------------------------------------------------------
\echo ''
\echo 'Seed aplicado:'
select t.slug,
       (select count(*) from core.memberships m where m.tenant_id = t.id)  as membros,
       (select count(*) from crm.companies c where c.tenant_id = t.id)     as empresas,
       (select count(*) from crm.deals d where d.tenant_id = t.id)         as negocios,
       (select count(*) from projects.projects p where p.tenant_id = t.id) as projetos,
       (select count(*) from projects.tasks k where k.tenant_id = t.id)    as tarefas,
       (select count(*) from billing.invoices i where i.tenant_id = t.id)  as faturas
from core.tenants t
where t.slug in ('acme', 'globex')
order by t.slug;
