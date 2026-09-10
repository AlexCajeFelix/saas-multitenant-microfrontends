-- ===========================================================================
-- 0009 — Operacoes do IAM que precisam ser atomicas.
-- O PostgREST nao encadeia varias instrucoes em uma transacao, entao a troca
-- do conjunto de permissoes de um papel vive aqui dentro.
-- ===========================================================================

-- security invoker de proposito: as politicas de RLS de iam.role_permissions
-- continuam valendo, e so quem pode gerenciar o papel consegue troca-las.
create or replace function iam.replace_role_permissions(
  p_role uuid,
  p_permissions text[]
)
returns setof text
language plpgsql
as $$
begin
  delete from iam.role_permissions where role_id = p_role;

  if array_length(p_permissions, 1) is not null then
    insert into iam.role_permissions (role_id, permission_slug)
    select p_role, unnest(p_permissions);
  end if;

  return query
    select rp.permission_slug
    from iam.role_permissions rp
    where rp.role_id = p_role
    order by 1;
end;
$$;

grant execute on function iam.replace_role_permissions(uuid, text[])
  to authenticated, service_role;

-- Quantos membros do tenant usam um determinado papel. Security definer porque
-- le core.memberships a partir do modulo iam.
create or replace function iam.count_members_using_role(p_tenant uuid, p_role_slug text)
returns integer
language sql
stable
security definer
set search_path = core, iam, public
as $$
  select count(*)::int
  from core.memberships m
  where m.tenant_id = p_tenant
    and lower(m.role_slug) = lower(p_role_slug)
    and m.status = 'active'
$$;

grant execute on function iam.count_members_using_role(uuid, text)
  to authenticated, service_role;
