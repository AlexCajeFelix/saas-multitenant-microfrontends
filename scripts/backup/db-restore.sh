#!/usr/bin/env bash
# ===========================================================================
# Restaura num projeto Supabase um backup feito por db-backup.sh.
#
#   scripts/backup/db-restore.sh <dev|prod> <pasta-do-backup>
#   (ou: make restore ENV=dev FROM=backups/dev/20261001T120000Z)
#
# SUBSTITUI o estado da aplicacao pelo do backup: derruba os schemas da
# aplicacao, esvazia as tabelas de auth e o historico de migrations e recria
# tudo a partir dos dumps, nesta ordem:
#   estrutura (app.dump) -> dados de auth (platform.dump) -> dados da aplicacao
#   -> indices, FKs, triggers, policies e grants (app.dump)
# e confere as linhas de cada tabela com o counts.tsv do backup ANTES do
# commit. Tudo numa transacao so: se qualquer passo ou a conferencia falhar, o
# banco fica exatamente como estava.
#
#   DRY_RUN=1    faz tudo, confere e desfaz no fim (ensaio sem efeito)
#   CONFIRM=env  pula a pergunta de confirmacao
# ===========================================================================
# $DB_URL entre aspas simples e de proposito: expande dentro do container.
# shellcheck disable=SC2016
set -euo pipefail

usage="uso: db-restore.sh <dev|prod> <pasta-do-backup>"
env="${1:?$usage}"
from="${2:?$usage}"
# shellcheck source=scripts/backup/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
load_env "$env"
from="$(cd "$from" && pwd)"
dry_run="${DRY_RUN:-}"

echo "==> conferindo a integridade de ${from#"$root"/}"
(cd "$from" && sha256sum --quiet -c SHA256SUMS)

if [[ -z "$dry_run" && "${CONFIRM:-}" != "$env" ]]; then
  echo "ATENCAO: apaga os dados atuais de $env ($REF) e coloca os do backup $(basename "$from")."
  read -r -p "Digite '$env' para continuar: " answer
  [[ "$answer" == "$env" ]] || { echo "cancelado"; exit 1; }
fi

work="$(mktemp -d)"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT
export WORK="$work"

# So volta o que e do postgres. O resto do dump e da plataforma e ja existe em
# qualquer projeto: o schema public (de pg_database_owner) e os default
# privileges do supabase_admin, que o postgres nem tem permissao de recriar.
pg "$from" pg_restore -l app.dump | awk '/^;/ || $NF == "postgres"' > "$work/app.list"
app() { pg "$from" pg_restore --no-owner -L /work/app.list "$@" -f - app.dump; }

schemas=()
for s in "${APP_SCHEMAS[@]}"; do [[ "$s" != public ]] && schemas+=("$s"); done
# public nao e da aplicacao: so saem os objetos que o backup recria.
public_drops="$(app --clean --if-exists --schema=public |
  grep -E '^(DROP |ALTER TABLE .* DROP CONSTRAINT )' | grep -v '^DROP SCHEMA' || true)"
platform_tables="$(pg "$from" pg_restore -l platform.dump |
  awk '$4 == "TABLE" && $5 == "DATA" { printf "%s\"%s\".\"%s\"", sep, $6, $7; sep = ", " }')"
expected="$(awk -F'\t' '{ gsub("'\''", "'\'''\''", $1); printf "%s('\''%s'\'', %d)", sep, $1, $2; sep = ", " }' "$from/counts.tsv")"

echo "==> montando o script de restauracao"
{
  echo "begin;"
  echo "drop schema if exists $(IFS=,; echo "${schemas[*]}") cascade;"
  [[ -n "$public_drops" ]] && echo "$public_drops"
  echo "truncate table $platform_tables;"
  app --section=pre-data
  pg "$from" pg_restore --no-owner --data-only -f - platform.dump
  app --section=data
  app --section=post-data
  cat <<SQL
-- Conferencia antes do commit: uma tabela com contagem diferente desfaz tudo.
create temp table _expected (t text, n bigint) on commit drop;
insert into pg_temp._expected values $expected;
do \$\$
declare
  r record;
  got bigint;
  bad text := '';
begin
  for r in select * from pg_temp._expected loop
    execute 'select count(*) from ' || r.t into got;
    if got <> r.n then
      bad := bad || format(E'\n  %s: backup %s, restaurado %s', r.t, r.n, got);
    end if;
  end loop;
  if bad <> '' then
    raise exception 'linhas diferentes do backup:%', bad;
  end if;
end \$\$;
select count(*) as tabelas, sum(n) as linhas from pg_temp._expected \gset
\echo '    ':tabelas 'tabelas e' :linhas 'linhas iguais ao backup'
SQL
  if [[ -n "$dry_run" ]]; then
    echo "rollback;"
  else
    # O PostgREST guarda o schema em cache; sem isto a API nao ve as tabelas.
    echo "notify pgrst, 'reload schema';"
    echo "commit;"
  fi
} > "$work/restore.sql"

# Sem os avisos do drop ... cascade (um por objeto derrubado).
quiet() { grep -vE 'NOTICE:|^DETAIL:|^HINT:|^drop cascades to |^and [0-9]+ other objects' "$1" || true; }

echo "==> restaurando em $env ($REF), numa transacao${dry_run:+ (ensaio: sera desfeita)}"
if ! pg "$work" sh -c 'psql "$DB_URL" -X -q -o /dev/null -v ON_ERROR_STOP=1 -f /work/restore.sql' > "$work/psql.log" 2>&1; then
  quiet "$work/psql.log" >&2
  echo "restauracao falhou: a transacao foi desfeita, o banco nao mudou" >&2
  exit 1
fi
quiet "$work/psql.log"

if [[ -n "$dry_run" ]]; then
  echo "==> ensaio ok: restaurado e conferido dentro da transacao, que foi desfeita"
else
  echo "==> pronto: $env restaurado de $(basename "$from")"
fi
