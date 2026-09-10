-- ===========================================================================
-- 0005 — Projetos: projetos, marcos, tarefas (com subtarefas), comentarios
-- e apontamento de horas.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'project_status' and n.nspname = 'projects') then
    create type projects.project_status as enum
      ('planning', 'active', 'on_hold', 'completed', 'archived');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'task_status' and n.nspname = 'projects') then
    create type projects.task_status as enum
      ('todo', 'in_progress', 'blocked', 'done', 'cancelled');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'task_priority' and n.nspname = 'projects') then
    create type projects.task_priority as enum ('low', 'medium', 'high', 'urgent');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------
create table if not exists projects.projects (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references core.tenants (id) on delete cascade,
  code               text not null,
  name               text not null,
  description        text not null default '',
  status             projects.project_status not null default 'planning',
  start_date         date,
  due_date           date,
  budget_cents       bigint not null default 0,
  currency           char(3) not null default 'BRL',
  owner_id           uuid,
  -- referencia fraca ao modulo CRM: sem FK entre schemas de modulos diferentes
  client_company_id  uuid,
  archived_at        timestamptz,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint projects_code_format check (code ~ '^[A-Z][A-Z0-9-]{1,15}$'),
  constraint projects_name_not_blank check (length(btrim(name)) between 2 and 160),
  constraint projects_budget_non_negative check (budget_cents >= 0),
  constraint projects_dates_ordered check (
    start_date is null or due_date is null or due_date >= start_date
  )
);

create unique index if not exists projects_code_key on projects.projects (tenant_id, upper(code));
create index if not exists projects_tenant_idx on projects.projects (tenant_id, status);

drop trigger if exists projects_touch on projects.projects;
create trigger projects_touch before update on projects.projects
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Marcos: entidade filha do agregado Project
-- ---------------------------------------------------------------------------
create table if not exists projects.milestones (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenants (id) on delete cascade,
  project_id    uuid not null references projects.projects (id) on delete cascade,
  name          text not null,
  due_date      date,
  position      integer not null default 1,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint milestones_name_not_blank check (length(btrim(name)) between 2 and 120)
);

create index if not exists milestones_project_idx on projects.milestones (project_id, position);

drop trigger if exists milestones_touch on projects.milestones;
create trigger milestones_touch before update on projects.milestones
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Tarefas. parent_task_id modela subtarefas dentro do mesmo tenant.
-- ---------------------------------------------------------------------------
create table if not exists projects.tasks (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references core.tenants (id) on delete cascade,
  project_id        uuid not null references projects.projects (id) on delete cascade,
  parent_task_id    uuid references projects.tasks (id) on delete cascade,
  milestone_id      uuid references projects.milestones (id) on delete set null,
  title             text not null,
  description       text not null default '',
  status            projects.task_status not null default 'todo',
  priority          projects.task_priority not null default 'medium',
  assignee_id       uuid,
  estimate_minutes  integer not null default 0,
  due_date          date,
  completed_at      timestamptz,
  position          integer not null default 1,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tasks_title_not_blank check (length(btrim(title)) between 2 and 200),
  constraint tasks_estimate_non_negative check (estimate_minutes >= 0),
  constraint tasks_not_own_parent check (parent_task_id is null or parent_task_id <> id),
  constraint tasks_completion_consistency check (
    (status = 'done' and completed_at is not null) or (status <> 'done' and completed_at is null)
  )
);

create index if not exists tasks_project_idx on projects.tasks (project_id, status);
create index if not exists tasks_tenant_idx on projects.tasks (tenant_id, created_at desc);
create index if not exists tasks_assignee_idx on projects.tasks (assignee_id) where status <> 'done';
create index if not exists tasks_parent_idx on projects.tasks (parent_task_id);

drop trigger if exists tasks_touch on projects.tasks;
create trigger tasks_touch before update on projects.tasks
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Comentarios e apontamento de horas: entidades filhas do agregado Task
-- ---------------------------------------------------------------------------
create table if not exists projects.task_comments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references core.tenants (id) on delete cascade,
  task_id     uuid not null references projects.tasks (id) on delete cascade,
  author_id   uuid,
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint task_comments_body_not_blank check (length(btrim(body)) between 1 and 4000)
);

create index if not exists task_comments_task_idx on projects.task_comments (task_id, created_at);

create table if not exists projects.time_entries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references core.tenants (id) on delete cascade,
  project_id  uuid not null references projects.projects (id) on delete cascade,
  task_id     uuid references projects.tasks (id) on delete cascade,
  user_id     uuid not null,
  minutes     integer not null,
  spent_on    date not null default current_date,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  constraint time_entries_minutes_range check (minutes between 1 and 1440)
);

create index if not exists time_entries_project_idx on projects.time_entries (project_id, spent_on desc);
create index if not exists time_entries_task_idx on projects.time_entries (task_id);
create index if not exists time_entries_user_idx on projects.time_entries (tenant_id, user_id, spent_on desc);

-- ---------------------------------------------------------------------------
-- Resumo de um projeto em uma unica consulta. security invoker: RLS vale.
-- ---------------------------------------------------------------------------
create or replace function projects.project_summary(p_project uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'projectId', p.id,
    'code', p.code,
    'name', p.name,
    'status', p.status::text,
    'tasks', jsonb_build_object(
      'total',       (select count(*) from projects.tasks t where t.project_id = p.id),
      'todo',        (select count(*) from projects.tasks t where t.project_id = p.id and t.status = 'todo'),
      'inProgress',  (select count(*) from projects.tasks t where t.project_id = p.id and t.status = 'in_progress'),
      'blocked',     (select count(*) from projects.tasks t where t.project_id = p.id and t.status = 'blocked'),
      'done',        (select count(*) from projects.tasks t where t.project_id = p.id and t.status = 'done'),
      'cancelled',   (select count(*) from projects.tasks t where t.project_id = p.id and t.status = 'cancelled')
    ),
    'milestones', jsonb_build_object(
      'total',     (select count(*) from projects.milestones m where m.project_id = p.id),
      'completed', (select count(*) from projects.milestones m where m.project_id = p.id and m.completed_at is not null)
    ),
    'loggedMinutes',   (select coalesce(sum(e.minutes), 0) from projects.time_entries e where e.project_id = p.id),
    'estimateMinutes', (select coalesce(sum(t.estimate_minutes), 0) from projects.tasks t where t.project_id = p.id),
    'budgetCents',     p.budget_cents,
    'currency',        p.currency
  )
  from projects.projects p
  where p.id = p_project
$$;

grant execute on function projects.project_summary(uuid) to authenticated, service_role;
