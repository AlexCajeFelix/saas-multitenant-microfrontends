#!/usr/bin/env bash
# ===========================================================================
# Restaura num projeto Supabase um backup feito por db-backup.sh.
#
#   scripts/backup/db-restore.sh <dev|prod> [backup]
#   (ou: make restore ENV=dev FROM=2026-10-01)
#
# [backup] e a pasta, o nome que aparece em `make backups` (20261001T141252Z),
# uma data (2026-10-01, a mais recente do dia em UTC) ou latest (padrao).
#
# SUBSTITUI o estado da aplicacao pelo do backup: derruba os schemas da
# aplicacao, esvazia as tabelas de auth e o historico de migrations e recria
# tudo a partir do dump, nesta ordem:
#   estrutura da aplicacao -> dados de auth e migrations -> dados da aplicacao
#   -> indices, FKs, triggers, policies e grants
# e confere as linhas de cada tabela com o counts.tsv do backup ANTES do
# commit. Tudo numa transacao so: se qualquer passo ou a conferencia falhar, o
# banco fica exatamente como estava. As sequencias (setval nao e transacional)
# so sao ajustadas depois da conferencia, imediatamente antes do commit.
#
#   DRY_RUN=1    faz tudo, confere e desfaz no fim, sem tocar nas sequencias
#                (ensaio sem efeito nenhum)
#   CONFIRM=env  pula a pergunta de confirmacao
# ===========================================================================
# $DB_URL entre aspas simples e de proposito: expande dentro do container.
# shellcheck disable=SC2016
set -euo pipefail

env="${1:?uso: db-restore.sh <dev|prod> [backup]}"
# shellcheck source=scripts/backup/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
load_env "$env"
from="$(resolve_backup "$env" "${2:-latest}")"
dry_run="${DRY_RUN:-}"

[[ -f "$from/db.dump" ]] || { echo "${from#"$root"/} nao tem db.dump (backup em formato antigo ou incompleto)" >&2; exit 2; }
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

schemas=()
for s in "${APP_SCHEMAS[@]}"; do [[ "$s" != public ]] && schemas+=("$s"); done
app_n=(); for s in "${APP_SCHEMAS[@]}"; do app_n+=(-n "$s"); done
platform_n=(); for s in "${PLATFORM_SCHEMAS[@]}"; do platform_n+=(-n "$s"); done

# Duas listas do mesmo dump, na ordem dele:
#   app.list       objetos dos schemas da aplicacao (e os CREATE SCHEMA deles)
#                  que sao do postgres. O resto e da plataforma e ja existe em
#                  qualquer projeto: o schema public (de pg_database_owner) e os
#                  default privileges do supabase_admin, que o postgres nem tem
#                  permissao de recriar;
#   platform.list  so os dados (TABLE DATA) de auth e migrations;
#   seq.list       os valores das sequencias, aplicados so no fim (veja abaixo).
pg "$from" pg_restore -l "${app_n[@]}" db.dump | awk '/^[0-9]/ { print $1 }' > "$work/app.ids"
pg "$from" pg_restore -l "${platform_n[@]}" db.dump | awk '/^[0-9]/ { print $1 }' > "$work/platform.ids"
pg "$from" pg_restore -l db.dump | awk -v schemas="${schemas[*]}" -v work="$work" '
  BEGIN {
    split(schemas, list, " "); for (i in list) own[list[i]] = 1
    while ((getline id < (work "/app.ids")) > 0) app[id] = 1
    while ((getline id < (work "/platform.ids")) > 0) platform[id] = 1
  }
  !/^[0-9]/ { next }
  $4 " " $5 == "SEQUENCE SET" { if ($1 in platform || ($1 in app && $NF == "postgres")) print > (work "/seq.list"); next }
  $1 in platform {
    if ($4 " " $5 == "TABLE DATA") print > (work "/platform.list")
    if ($4 " " $5 == "FK CONSTRAINT") print > (work "/platform-fk.list")
    next
  }
  $NF != "postgres" { next }
  $1 in app || ($5 == "-" && $(NF - 1) in own) { print > (work "/app.list") }'
app() { pg "$from" pg_restore --no-owner -L /work/app.list "$@" -f - db.dump; }

# As tabelas de auth ja existem no destino, com as FKs valendo: os dados delas
# precisam entrar na ordem das dependencias (users antes de identities). O
# dump nao garante isso, entao a ordem sai das FKs do proprio dump, via tsort.
touch "$work/platform-fk.list"
pg "$from" pg_restore -L /work/platform-fk.list -f - db.dump |
  awk '/^ALTER TABLE ONLY / { table = $4 }
       match($0, /REFERENCES [^(]+/) { print substr($0, RSTART + 11, RLENGTH - 11), table }' |
  tsort > "$work/platform.order"
awk 'NR == FNR { rank[$0] = NR; next }
     { print (($6 "." $7) in rank ? rank[$6 "." $7] : 0) "\t" $0 }' "$work/platform.order" "$work/platform.list" |
  sort -s -n -k1,1 | cut -f2- > "$work/platform.sorted"

# public nao e da aplicacao: so saem os objetos que o backup recria.
public_drops="$(app --clean --if-exists --schema=public |
  grep -E '^(DROP |ALTER TABLE .* DROP CONSTRAINT )' | grep -v '^DROP SCHEMA' || true)"
# Valores das sequencias no backup, como linhas de VALUES: ('esquema.seq', 42, true)
touch "$work/seq.list"
sequences="$(pg "$from" pg_restore -L /work/seq.list -f - db.dump |
  sed -n 's/^SELECT pg_catalog.setval(\(.*\));$/(\1)/p' | paste -sd, -)"
platform_tables="$(awk '$4 == "TABLE" && $5 == "DATA" { printf "%s\"%s\".\"%s\"", sep, $6, $7; sep = ", " }' "$work/platform.list")"
expected="$(awk -F'\t' '{ gsub("'\''", "'\'''\''", $1); printf "%s('\''%s'\'', %d)", sep, $1, $2; sep = ", " }' "$from/counts.tsv")"

echo "==> montando o script de restauracao"
{
  echo "begin;"
  echo "drop schema if exists $(IFS=,; echo "${schemas[*]}") cascade;"
  [[ -n "$public_drops" ]] && echo "$public_drops"
  echo "truncate table $platform_tables;"
  app --section=pre-data
  pg "$from" pg_restore --no-owner -L /work/platform.sorted -f - db.dump
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
    # Sequencias por ultimo, so depois da conferencia: setval nao e
    # transacional, um rollback nao o desfaz. Por isso o ensaio (DRY_RUN) nem
    # chega aqui. E nunca abaixo do maior id restaurado, mesmo que o dump
    # tenha pego uma sequencia atrasada.
    [[ -n "$sequences" ]] && cat <<SQL
do \$\$
declare
  r record;
  col record;
  top bigint;
begin
  for r in select * from (values $sequences) as v (seq, val, called) loop
    top := null;
    for col in
      select a.attrelid::regclass as tab, a.attname
      from pg_depend d
      join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
      where d.classid = 'pg_class'::regclass and d.objid = r.seq::regclass
        and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
    loop
      execute format('select max(%I) from %s', col.attname, col.tab) into top;
    end loop;
    if top is not null and top >= r.val then
      perform pg_catalog.setval(r.seq::regclass, top, true);
    else
      perform pg_catalog.setval(r.seq::regclass, r.val, r.called);
    end if;
  end loop;
end \$\$;
SQL
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
