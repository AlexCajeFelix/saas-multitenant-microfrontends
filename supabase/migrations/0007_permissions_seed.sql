-- ===========================================================================
-- 0007 — Catalogo de permissoes, papeis de sistema e planos.
-- Reexecutavel: tudo com on conflict do nothing / update.
-- ===========================================================================

insert into iam.permissions (slug, module, description) values
  ('tenancy.tenant.read',      'tenancy',  'Ver dados do tenant'),
  ('tenancy.tenant.write',     'tenancy',  'Alterar, suspender e reativar o tenant'),
  ('tenancy.member.read',      'tenancy',  'Listar membros'),
  ('tenancy.member.write',     'tenancy',  'Alterar papel e remover membros'),
  ('tenancy.invitation.read',  'tenancy',  'Listar convites'),
  ('tenancy.invitation.write', 'tenancy',  'Convidar e revogar convites'),
  ('tenancy.audit.read',       'tenancy',  'Ler a trilha de auditoria'),

  ('iam.role.read',            'iam',      'Listar papeis'),
  ('iam.role.write',           'iam',      'Criar, alterar e excluir papeis'),
  ('iam.permission.read',      'iam',      'Ler o catalogo de permissoes'),
  ('iam.api_key.read',         'iam',      'Listar chaves de API'),
  ('iam.api_key.write',        'iam',      'Emitir e revogar chaves de API'),

  ('crm.company.read',         'crm',      'Ver empresas'),
  ('crm.company.write',        'crm',      'Criar e alterar empresas'),
  ('crm.contact.read',         'crm',      'Ver contatos'),
  ('crm.contact.write',        'crm',      'Criar e alterar contatos'),
  ('crm.deal.read',            'crm',      'Ver negocios'),
  ('crm.deal.write',           'crm',      'Criar, mover e fechar negocios'),
  ('crm.activity.read',        'crm',      'Ver atividades'),
  ('crm.activity.write',       'crm',      'Registrar atividades'),
  ('crm.pipeline.read',        'crm',      'Ver o funil'),
  ('crm.pipeline.write',       'crm',      'Configurar os estagios do funil'),

  ('projects.project.read',    'projects', 'Ver projetos'),
  ('projects.project.write',   'projects', 'Criar, alterar e arquivar projetos'),
  ('projects.milestone.write', 'projects', 'Gerenciar marcos'),
  ('projects.task.read',       'projects', 'Ver tarefas'),
  ('projects.task.write',      'projects', 'Criar, atribuir e mover tarefas'),
  ('projects.comment.write',   'projects', 'Comentar em tarefas'),
  ('projects.time_entry.read', 'projects', 'Ver apontamentos de horas'),
  ('projects.time_entry.write','projects', 'Lancar horas'),

  ('billing.plan.read',        'billing',  'Ver o catalogo de planos'),
  ('billing.subscription.read','billing',  'Ver a assinatura do tenant'),
  ('billing.subscription.write','billing', 'Assinar, trocar de plano e cancelar'),
  ('billing.invoice.read',     'billing',  'Ver faturas'),
  ('billing.invoice.write',    'billing',  'Emitir e liquidar faturas'),
  ('billing.usage.read',       'billing',  'Ver o consumo medido'),
  ('billing.usage.write',      'billing',  'Registrar consumo')
on conflict (slug) do update
  set module = excluded.module, description = excluded.description;

-- ---------------------------------------------------------------------------
-- Papeis de sistema (tenant_id nulo)
-- ---------------------------------------------------------------------------
insert into iam.roles (id, tenant_id, slug, name, description, is_system) values
  ('11111111-1111-4111-8111-000000000001', null, 'owner',   'Dono',        'Controle total, inclusive faturamento', true),
  ('11111111-1111-4111-8111-000000000002', null, 'admin',   'Administrador','Administra o tenant, sem acesso financeiro', true),
  ('11111111-1111-4111-8111-000000000003', null, 'manager', 'Gestor',      'Conduz CRM e projetos', true),
  ('11111111-1111-4111-8111-000000000004', null, 'member',  'Membro',      'Opera o dia a dia de CRM e projetos', true),
  ('11111111-1111-4111-8111-000000000005', null, 'viewer',  'Leitor',      'Somente leitura', true)
on conflict (id) do update
  set name = excluded.name, description = excluded.description, is_system = true;

do $$
declare
  r_owner   uuid := '11111111-1111-4111-8111-000000000001';
  r_admin   uuid := '11111111-1111-4111-8111-000000000002';
  r_manager uuid := '11111111-1111-4111-8111-000000000003';
  r_member  uuid := '11111111-1111-4111-8111-000000000004';
  r_viewer  uuid := '11111111-1111-4111-8111-000000000005';
begin
  delete from iam.role_permissions
   where role_id in (r_owner, r_admin, r_manager, r_member, r_viewer);

  -- owner: tudo
  insert into iam.role_permissions (role_id, permission_slug)
  select r_owner, slug from iam.permissions;

  -- admin: tudo menos escrever no financeiro
  insert into iam.role_permissions (role_id, permission_slug)
  select r_admin, slug from iam.permissions
   where slug not in ('billing.subscription.write', 'billing.invoice.write');

  -- manager: le tudo, escreve em CRM e projetos
  insert into iam.role_permissions (role_id, permission_slug)
  select r_manager, slug from iam.permissions
   where slug like '%.read'
      or slug like 'crm.%.write'
      or slug in (
        'projects.project.write', 'projects.milestone.write', 'projects.task.write',
        'projects.comment.write', 'projects.time_entry.write', 'billing.usage.write'
      );

  -- member: opera CRM e tarefas, nao cria projetos nem mexe em papeis
  insert into iam.role_permissions (role_id, permission_slug)
  select r_member, slug from iam.permissions
   where slug in (
      'tenancy.tenant.read', 'tenancy.member.read',
      'crm.company.read', 'crm.company.write',
      'crm.contact.read', 'crm.contact.write',
      'crm.deal.read', 'crm.deal.write',
      'crm.activity.read', 'crm.activity.write',
      'crm.pipeline.read',
      'projects.project.read',
      'projects.task.read', 'projects.task.write',
      'projects.comment.write',
      'projects.time_entry.read', 'projects.time_entry.write',
      'billing.plan.read'
   );

  -- viewer: somente leitura
  insert into iam.role_permissions (role_id, permission_slug)
  select r_viewer, slug from iam.permissions where slug like '%.read';
end $$;

-- ---------------------------------------------------------------------------
-- Planos. limits com null significa ilimitado.
-- ---------------------------------------------------------------------------
insert into billing.plans (code, name, description, price_cents, currency, interval, trial_days, features, limits, position) values
  ('free', 'Free', 'Para experimentar o produto', 0, 'BRL', 'month', 0,
   '["1 funil de vendas","Suporte pela comunidade"]'::jsonb,
   '{"users": 3, "projects": 2, "deals": 50, "contacts": 200}'::jsonb, 1),
  ('starter', 'Starter', 'Para times pequenos', 9900, 'BRL', 'month', 14,
   '["Funis ilimitados","Relatorios basicos","Suporte por e-mail"]'::jsonb,
   '{"users": 10, "projects": 20, "deals": 500, "contacts": 5000}'::jsonb, 2),
  ('pro', 'Pro', 'Para times em crescimento', 29900, 'BRL', 'month', 14,
   '["Papeis personalizados","Chaves de API","Auditoria completa"]'::jsonb,
   '{"users": 50, "projects": 200, "deals": 5000, "contacts": 50000}'::jsonb, 3),
  ('enterprise', 'Enterprise', 'Sem limites, com acordo de nivel de servico', 99900, 'BRL', 'month', 0,
   '["Tudo do Pro","SLA","Onboarding dedicado"]'::jsonb,
   '{"users": null, "projects": null, "deals": null, "contacts": null}'::jsonb, 4)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      price_cents = excluded.price_cents,
      features = excluded.features,
      limits = excluded.limits,
      position = excluded.position;
