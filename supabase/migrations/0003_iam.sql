-- ===========================================================================
-- 0003 — IAM: catalogo de permissoes, papeis (globais e por tenant),
-- vinculo papel/permissao e chaves de API. Aqui tambem nasce a funcao
-- core.has_permission, coracao de toda a RLS do sistema.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Catalogo global de permissoes: "modulo.recurso.acao"
-- ---------------------------------------------------------------------------
create table if not exists iam.permissions (
  slug         text primary key,
  module       text not null,
  description  text not null,
  created_at   timestamptz not null default now(),
  constraint permissions_slug_format check (slug ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')
);

-- ---------------------------------------------------------------------------
-- Papeis. tenant_id nulo = papel de sistema, visivel para todos os tenants.
-- Um papel do tenant com o mesmo slug de um papel de sistema tem precedencia.
-- ---------------------------------------------------------------------------
create table if not exists iam.roles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references core.tenants (id) on delete cascade,
  slug         text not null,
  name         text not null,
  description  text not null default '',
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint roles_slug_format check (slug ~ '^[a-z][a-z0-9_-]{1,30}$')
);

create unique index if not exists roles_scope_slug_key
  on iam.roles (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(slug));
create index if not exists roles_tenant_idx on iam.roles (tenant_id);

drop trigger if exists roles_touch on iam.roles;
create trigger roles_touch before update on iam.roles
  for each row execute function core.touch_updated_at();

create table if not exists iam.role_permissions (
  role_id          uuid not null references iam.roles (id) on delete cascade,
  permission_slug  text not null references iam.permissions (slug) on delete cascade,
  granted_at       timestamptz not null default now(),
  primary key (role_id, permission_slug)
);

-- ---------------------------------------------------------------------------
-- Chaves de API por tenant. O segredo so existe na resposta da criacao;
-- o banco guarda prefixo (para exibir) e o hash SHA-256 (para conferir).
-- ---------------------------------------------------------------------------
create table if not exists iam.api_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenants (id) on delete cascade,
  name          text not null,
  prefix        text not null,
  key_hash      text not null unique,
  scopes        text[] not null default '{}',
  created_by    uuid,
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint api_keys_name_not_blank check (length(btrim(name)) between 2 and 80)
);

create index if not exists api_keys_tenant_idx on iam.api_keys (tenant_id);
create index if not exists api_keys_prefix_idx on iam.api_keys (prefix);

drop trigger if exists api_keys_touch on iam.api_keys;
create trigger api_keys_touch before update on iam.api_keys
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Papel efetivo do usuario dentro de um tenant
-- ---------------------------------------------------------------------------
create or replace function iam.effective_role_id(p_tenant uuid, p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = iam, core, public
as $$
  select r.id
  from core.memberships m
  join iam.roles r
    on lower(r.slug) = lower(m.role_slug)
   and (r.tenant_id = m.tenant_id or r.tenant_id is null)
  where m.tenant_id = p_tenant
    and m.user_id = p_user
    and m.status = 'active'
  order by (r.tenant_id is null)   -- papel do proprio tenant vem primeiro
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- A pergunta que a RLS faz em toda linha: este usuario pode isto neste tenant?
-- ---------------------------------------------------------------------------
create or replace function core.has_permission(
  p_tenant     uuid,
  p_permission text,
  p_user       uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = core, iam, public
as $$
  select
    p_tenant is not null
    and p_user is not null
    and (
      -- dono do tenant tem tudo, inclusive permissoes criadas depois dele
      exists (
        select 1 from core.memberships m
        where m.tenant_id = p_tenant
          and m.user_id = p_user
          and m.status = 'active'
          and m.role_slug = 'owner'
      )
      or exists (
        select 1 from iam.role_permissions rp
        where rp.role_id = iam.effective_role_id(p_tenant, p_user)
          and rp.permission_slug = p_permission
      )
    )
$$;

create or replace function core.permissions_for(p_tenant uuid, p_user uuid default auth.uid())
returns text[]
language sql
stable
security definer
set search_path = core, iam, public
as $$
  select coalesce(
    case
      when exists (
        select 1 from core.memberships m
        where m.tenant_id = p_tenant and m.user_id = p_user
          and m.status = 'active' and m.role_slug = 'owner'
      )
      then (select array_agg(p.slug order by p.slug) from iam.permissions p)
      else (
        select array_agg(rp.permission_slug order by rp.permission_slug)
        from iam.role_permissions rp
        where rp.role_id = iam.effective_role_id(p_tenant, p_user)
      )
    end,
    '{}'::text[]
  )
$$;

-- ---------------------------------------------------------------------------
-- Uma unica ida ao banco para montar o RequestContext das Edge Functions
-- ---------------------------------------------------------------------------
create or replace function core.access_context(p_tenant uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = core, iam, public
as $$
  select jsonb_build_object(
    'tenant_id',   p_tenant,
    'user_id',     p_user,
    'is_member',   core.is_member(p_tenant, p_user),
    'role',        core.member_role(p_tenant, p_user),
    'tenant_status', (select t.status::text from core.tenants t where t.id = p_tenant),
    'permissions', to_jsonb(core.permissions_for(p_tenant, p_user))
  )
$$;

grant execute on function
  iam.effective_role_id(uuid, uuid),
  core.has_permission(uuid, text, uuid),
  core.permissions_for(uuid, uuid),
  core.access_context(uuid, uuid)
  to anon, authenticated, service_role;
