-- ===========================================================================
-- 0010 — Versao do schema exposta para o health check do deploy.
--
-- O pipeline compara a ultima migration do repositorio com a ultima aplicada no
-- banco, pela API publica (`POST /rest/v1/rpc/schema_version`). Assim "subiu"
-- quer dizer "o banco esta exatamente na versao deste commit", e nao so "o
-- banco respondeu".
--
-- No Supabase o historico fica em supabase_migrations.schema_migrations. O stack
-- do docker compose nao tem essa tabela; ali a funcao devolve null.
-- ===========================================================================

create or replace function public.schema_version()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  latest text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return null;
  end if;
  execute 'select max(version) from supabase_migrations.schema_migrations' into latest;
  return latest;
end;
$$;

revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
