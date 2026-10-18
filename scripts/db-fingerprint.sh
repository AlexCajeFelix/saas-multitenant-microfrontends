#!/usr/bin/env bash
# Foto do banco local: linhas e md5 do conteudo de cada tabela dos schemas da
# aplicacao, mais os usuarios do Auth, e uma linha TOTAL com o md5 de tudo.
# Para provar um restore, compare a saida de antes do backup com a de depois:
#
#   make fingerprint > antes.txt
#   ... backup, apagar, restore ...
#   make fingerprint > depois.txt && diff antes.txt depois.txt && echo identico
#
# Usar a aplicacao entre as duas fotos muda o resultado de proposito: toda
# escrita grava em core.audit_logs.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  psql -U postgres -d "${POSTGRES_DB:-postgres}" -X -q -v ON_ERROR_STOP=1 -P footer=off << 'SQL'
-- Funcao temporaria: some no fim da sessao e nao entra no banco.
create function pg_temp.fingerprint()
returns table (tabela text, linhas bigint, md5 text)
language plpgsql
as $$
declare
  r record;
begin
  for r in
    -- auth.users so por id e e-mail: o GoTrue reescreve o resto a cada login.
    select 'auth.users' as nome, 'select id, email from auth.users' as origem
    union all
    select format('%s.%s', n.nspname, c.relname), format('select * from %I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname in ('public', 'core', 'iam', 'crm', 'projects', 'billing')
    order by 1
  loop
    tabela := r.nome;
    execute format(
      'select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t::text), '''')) from (%s) t',
      r.origem)
      into linhas, md5;
    return next;
  end loop;
end;
$$;

with foto as (select row_number() over () as ordem, * from pg_temp.fingerprint())
select tabela, linhas, md5 from (
  select ordem, tabela, linhas, md5 from foto
  union all
  select null, 'TOTAL', sum(linhas), md5(string_agg(md5, '' order by ordem)) from foto
) x
order by ordem nulls last;
SQL
