-- ===========================================================================
-- Seed de volume: o tenant "carga" com cerca de :n registros nos modulos de CRM
-- e de projetos, para ensaiar backup e restore com um banco que pesa.
--
-- Recebe via psql (scripts/seed-volume.sh, ou make seed-volume N=...):
--   -v n=100000 -v owner=<id da alice> -v member=<id do bruno>
--
-- Reexecutavel: apaga o tenant antes de recriar, e o cascata leva tudo junto.
-- Os ids saem do md5 do numero da linha, entao filhos acham os pais sem
-- consulta e duas execucoes geram os mesmos ids. Roda numa transacao so: se
-- falhar no meio, nada fica.
-- ===========================================================================

\set carga 'cccccccc-cccc-4ccc-8ccc-000000000001'

-- Distribuicao do total: 5% empresas, 20% contatos, 20% negocios, 30%
-- atividades, 0,5% projetos (3 marcos cada), 15% tarefas, 5% comentarios e
-- 3% apontamentos de horas. Com n=100000 a soma da exatamente 100000.
select :n * 5 / 100   as n_empresas,
       :n * 20 / 100  as n_contatos,
       :n * 20 / 100  as n_negocios,
       :n * 30 / 100  as n_atividades,
       :n * 5 / 1000  as n_projetos,
       :n * 5 / 1000 * 3 as n_marcos,
       :n * 15 / 100  as n_tarefas,
       :n * 5 / 100   as n_comentarios,
       :n * 3 / 100   as n_horas
\gset

begin;

delete from core.tenants where slug = 'carga';

-- ---------------------------------------------------------------------------
-- Tenant, membros, funil e assinatura (Enterprise: sem limite de contatos e
-- negocios, que o volume estouraria nos outros planos)
-- ---------------------------------------------------------------------------
insert into core.tenants (id, slug, name, status, settings, created_by) values
  (:'carga'::uuid, 'carga', 'Carga de Volume', 'active',
   '{"locale":"pt-BR","timezone":"America/Sao_Paulo"}'::jsonb, :'owner'::uuid);

insert into core.memberships (tenant_id, user_id, role_slug, status) values
  (:'carga'::uuid, :'owner'::uuid,  'owner',   'active'),
  (:'carga'::uuid, :'member'::uuid, 'manager', 'active')
-- owner e member podem ser o mesmo usuario (o dev so tem o do smoke).
on conflict (tenant_id, user_id) do nothing;

select crm.install_default_pipeline(:'carga'::uuid) \g /dev/null

insert into billing.subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end, created_by)
select :'carga'::uuid, p.id, 'active',
       date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', :'owner'::uuid
from billing.plans p where p.code = 'enterprise';

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
insert into crm.companies (id, tenant_id, name, domain, industry, size, phone, address, owner_id, created_by, created_at)
select md5('carga:empresa:' || i)::uuid, :'carga'::uuid,
       (array['Comercial', 'Industria', 'Distribuidora', 'Servicos', 'Transportes', 'Tecnologia', 'Clinica', 'Construtora'])[1 + i % 8]
         || ' ' || (array['Aurora', 'Horizonte', 'Atlas', 'Vale Verde', 'Boa Vista', 'Sao Jorge', 'Mar Azul', 'Serra Alta', 'Nova Era', 'Primavera'])[1 + i / 8 % 10]
         || ' ' || i,
       'empresa' || i || '.com.br',
       (array['Alimentos', 'Logistica', 'Saude', 'Varejo', 'Tecnologia', 'Educacao', 'Construcao', 'Financeiro'])[1 + i % 8],
       (array['1-10', '11-50', '51-200', '201-500', '500+'])[1 + i % 5],
       '+55 11 9' || lpad((i::bigint * 7919 % 100000000)::text, 8, '0'),
       jsonb_build_object(
         'cidade', (array['Sao Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Recife', 'Salvador', 'Fortaleza'])[1 + i % 8],
         'uf',     (array['SP', 'RJ', 'MG', 'PR', 'RS', 'PE', 'BA', 'CE'])[1 + i % 8]),
       case when i % 3 = 0 then :'member'::uuid else :'owner'::uuid end,
       :'owner'::uuid,
       now() - (i % 730) * interval '1 day'
from generate_series(1, :n_empresas) i;

-- O contato j trabalha na empresa 1 + j % n_empresas.
insert into crm.contacts (id, tenant_id, company_id, first_name, last_name, email, phone, job_title, owner_id, created_by, created_at)
select md5('carga:contato:' || j)::uuid, :'carga'::uuid,
       md5('carga:empresa:' || (1 + j % :n_empresas))::uuid,
       (array['Ana', 'Bruno', 'Camila', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'Joao',
              'Larissa', 'Marcos', 'Natalia', 'Otavio', 'Paula', 'Rafael', 'Sofia', 'Thiago', 'Vanessa', 'Wagner'])[1 + j % 20],
       (array['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Almeida', 'Ferreira', 'Rodrigues',
              'Gomes', 'Martins', 'Araujo', 'Barbosa', 'Ribeiro'])[1 + j / 20 % 15],
       'contato' || j || '@empresa' || (1 + j % :n_empresas) || '.com.br',
       '+55 21 9' || lpad((j::bigint * 104729 % 100000000)::text, 8, '0'),
       (array['Diretor', 'Gerente de Compras', 'Analista', 'Coordenador', 'Socio', 'Supervisor'])[1 + j % 6],
       case when j % 3 = 0 then :'member'::uuid else :'owner'::uuid end,
       :'owner'::uuid,
       now() - (j % 700) * interval '1 day'
from generate_series(1, :n_contatos) j;

-- O negocio k e com o contato c e com a empresa dele. O estagio sai de k % 10:
-- 60% abertos espalhados pelo funil, 30% ganhos e 10% perdidos.
insert into crm.deals (id, tenant_id, title, company_id, contact_id, stage_key, status, amount_cents, currency,
                       probability, expected_close_date, closed_at, lost_reason, owner_id, created_by, created_at)
select md5('carga:negocio:' || k)::uuid, :'carga'::uuid,
       (array['Licencas', 'Implantacao', 'Suporte anual', 'Consultoria', 'Treinamento', 'Integracao', 'Renovacao', 'Expansao'])[1 + k % 8]
         || ' #' || k,
       md5('carga:empresa:' || (1 + c % :n_empresas))::uuid,
       md5('carga:contato:' || c)::uuid,
       e.stage_key, e.status::crm.deal_status,
       50000 + (k::bigint * 7919 % 200) * 25000, 'BRL', e.probability,
       current_date + (k % 120 - 30),
       case when e.status <> 'open' then now() - (k % 365) * interval '1 day' + (k % 30) * interval '1 day' end,
       case when e.status = 'lost' then (array['Preco', 'Concorrente', 'Sem orcamento', 'Prazo'])[1 + k % 4] end,
       case when k % 3 = 0 then :'member'::uuid else :'owner'::uuid end,
       :'owner'::uuid,
       now() - (k % 365) * interval '1 day' - interval '30 days'
from generate_series(1, :n_negocios) k
cross join lateral (select 1 + (k - 1) % :n_contatos as c) contato
join (values
  (0, 'lead', 'open', 10), (1, 'lead', 'open', 10), (2, 'qualified', 'open', 30), (3, 'qualified', 'open', 30),
  (4, 'proposal', 'open', 60), (5, 'proposal', 'open', 60), (6, 'negotiation', 'open', 80),
  (7, 'won', 'won', 100), (8, 'won', 'won', 100), (9, 'lost', 'lost', 0)
) as e (slot, stage_key, status, probability) on e.slot = k % 10;

insert into crm.activities (id, tenant_id, deal_id, kind, subject, notes, occurred_at, created_by, created_at)
select md5('carga:atividade:' || a)::uuid, :'carga'::uuid,
       md5('carga:negocio:' || (1 + (a - 1) % :n_negocios))::uuid,
       (array['call', 'email', 'meeting', 'note', 'task'])[1 + a % 5]::crm.activity_kind,
       (array['Ligacao de qualificacao', 'Envio de proposta', 'Reuniao de alinhamento', 'Anotacao interna', 'Follow-up'])[1 + a % 5],
       'Registro ' || a || ' gerado pelo seed de volume',
       now() - (a % 365) * interval '1 day' - (a % 24) * interval '1 hour',
       case when a % 3 = 0 then :'member'::uuid else :'owner'::uuid end,
       now() - (a % 365) * interval '1 day'
from generate_series(1, :n_atividades) a;

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------
insert into projects.projects (id, tenant_id, code, name, description, status, start_date, due_date, budget_cents,
                               currency, owner_id, client_company_id, created_by, created_at)
select md5('carga:projeto:' || p)::uuid, :'carga'::uuid,
       'P' || lpad(p::text, 5, '0'),
       (array['Implantacao', 'Migracao', 'Integracao', 'Treinamento', 'Auditoria'])[1 + p % 5] || ' ' || p,
       'Projeto ' || p || ' gerado pelo seed de volume',
       (array['planning', 'active', 'active', 'on_hold', 'completed'])[1 + p % 5]::projects.project_status,
       current_date - p % 300,
       current_date - p % 300 + 30 + p % 200,
       1000000 + (p::bigint * 7919 % 100) * 500000, 'BRL',
       case when p % 3 = 0 then :'member'::uuid else :'owner'::uuid end,
       md5('carga:empresa:' || (1 + p % :n_empresas))::uuid,
       :'owner'::uuid,
       now() - (p % 300) * interval '1 day'
from generate_series(1, :n_projetos) p;

-- O marco m e do projeto 1 + (m - 1) % n_projetos, na posicao 1, 2 ou 3.
insert into projects.milestones (id, tenant_id, project_id, name, due_date, position, completed_at)
select md5('carga:marco:' || m)::uuid, :'carga'::uuid,
       md5('carga:projeto:' || (1 + (m - 1) % :n_projetos))::uuid,
       (array['Descoberta', 'Entrega parcial', 'Entrega final'])[pos],
       current_date + (pos * 30 - 45),
       pos,
       case when pos = 1 then now() - (m % 60) * interval '1 day' end
from generate_series(1, :n_marcos) m
cross join lateral (select 1 + (m - 1) / :n_projetos as pos) posicao;

-- A tarefa t e do projeto 1 + (t - 1) % n_projetos e de um dos tres marcos
-- dele. Uma em cada dez (a partir da segunda volta) e subtarefa da tarefa
-- t - n_projetos, que e do mesmo projeto.
insert into projects.tasks (id, tenant_id, project_id, parent_task_id, milestone_id, title, description, status,
                            priority, assignee_id, estimate_minutes, due_date, completed_at, position, created_by, created_at)
select md5('carga:tarefa:' || t)::uuid, :'carga'::uuid,
       md5('carga:projeto:' || proj)::uuid,
       case when t % 10 = 0 and t > :n_projetos then md5('carga:tarefa:' || (t - :n_projetos))::uuid end,
       md5('carga:marco:' || (proj + :n_projetos * (t % 3)))::uuid,
       (array['Levantar requisitos', 'Configurar ambiente', 'Migrar dados', 'Validar com o cliente', 'Documentar', 'Treinar usuarios'])[1 + t % 6]
         || ' #' || t,
       'Tarefa ' || t || ' gerada pelo seed de volume',
       st.status::projects.task_status,
       (array['low', 'medium', 'medium', 'high', 'urgent'])[1 + t % 5]::projects.task_priority,
       case when t % 2 = 0 then :'member'::uuid else :'owner'::uuid end,
       30 * (1 + t % 16),
       current_date + (t % 90 - 30),
       case when st.status = 'done' then now() - (t % 60) * interval '1 day' end,
       1 + (t - 1) / :n_projetos,
       :'owner'::uuid,
       now() - (t % 300) * interval '1 day'
from generate_series(1, :n_tarefas) t
cross join lateral (select 1 + (t - 1) % :n_projetos as proj) projeto
cross join lateral (select (array['todo', 'in_progress', 'blocked', 'done', 'done', 'cancelled'])[1 + t % 6] as status) st;

insert into projects.task_comments (id, tenant_id, task_id, author_id, body, created_at)
select md5('carga:comentario:' || cm)::uuid, :'carga'::uuid,
       md5('carga:tarefa:' || (1 + (cm - 1) % :n_tarefas))::uuid,
       case when cm % 2 = 0 then :'member'::uuid else :'owner'::uuid end,
       (array['Atualizei o status com o cliente.', 'Aguardando retorno do fornecedor.', 'Revisado e aprovado.',
              'Precisa de mais detalhes antes de seguir.', 'Bloqueio resolvido.'])[1 + cm % 5] || ' (#' || cm || ')',
       now() - (cm % 200) * interval '1 day'
from generate_series(1, :n_comentarios) cm;

-- O apontamento h e na tarefa 1 + (h - 1) % n_tarefas, no projeto dela.
insert into projects.time_entries (id, tenant_id, project_id, task_id, user_id, minutes, spent_on, notes, created_at)
select md5('carga:horas:' || h)::uuid, :'carga'::uuid,
       md5('carga:projeto:' || (1 + (tarefa - 1) % :n_projetos))::uuid,
       md5('carga:tarefa:' || tarefa)::uuid,
       case when h % 2 = 0 then :'member'::uuid else :'owner'::uuid end,
       15 * (1 + h % 32),
       current_date - h % 180,
       'Apontamento ' || h,
       now() - (h % 180) * interval '1 day'
from generate_series(1, :n_horas) h
cross join lateral (select 1 + (h - 1) % :n_tarefas as tarefa) t;

commit;

-- Estatisticas em dia para as contagens da API nao partirem de tabela vazia.
analyze crm.companies, crm.contacts, crm.deals, crm.activities,
        projects.projects, projects.milestones, projects.tasks, projects.task_comments, projects.time_entries;

-- ---------------------------------------------------------------------------
-- Resumo
-- ---------------------------------------------------------------------------
\echo ''
\echo 'Tenant carga:'
with linhas (ordem, tabela, total) as (
  select 1, 'crm.companies',          count(*) from crm.companies           where tenant_id = :'carga'::uuid union all
  select 2, 'crm.contacts',           count(*) from crm.contacts            where tenant_id = :'carga'::uuid union all
  select 3, 'crm.deals',              count(*) from crm.deals               where tenant_id = :'carga'::uuid union all
  select 4, 'crm.activities',         count(*) from crm.activities          where tenant_id = :'carga'::uuid union all
  select 5, 'projects.projects',      count(*) from projects.projects       where tenant_id = :'carga'::uuid union all
  select 6, 'projects.milestones',    count(*) from projects.milestones     where tenant_id = :'carga'::uuid union all
  select 7, 'projects.tasks',         count(*) from projects.tasks          where tenant_id = :'carga'::uuid union all
  select 8, 'projects.task_comments', count(*) from projects.task_comments  where tenant_id = :'carga'::uuid union all
  select 9, 'projects.time_entries',  count(*) from projects.time_entries   where tenant_id = :'carga'::uuid
)
select tabela, total from (
  select ordem, tabela, total from linhas
  union all
  select 10, 'total', sum(total) from linhas
) x
order by ordem;
