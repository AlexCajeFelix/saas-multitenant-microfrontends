#!/usr/bin/env bash
# ===========================================================================
# Backup do Postgres de um projeto Supabase numa pasta local.
#
#   scripts/backup/db-backup.sh <dev|prod> [--if-changed]
#   (ou: make backup ENV=prod)
#
# Gera backups/<env>/<data UTC>/ com:
#   db.dump     um pg_dump so (uma foto consistente do banco): estrutura e dados
#               dos schemas da aplicacao, mais os dados de auth e do historico
#               de migrations (a estrutura desses e do Supabase)
#   counts.tsv  linhas por tabela, contadas no proprio dump
#   state       estado do banco no momento do backup (veja state_sql)
#   SHA256SUMS  integridade dos arquivos (o restore confere)
# e mantem so os BACKUP_KEEP backups mais recentes (padrao 7).
#
# --if-changed: antes do dump, compara o estado do banco (~100 bytes de
# egress) com o do ultimo backup e pula se nada mudou. E o modo do agendamento.
#
# Conexao: SUPABASE_REF_<ENV> e SUPABASE_DB_PASSWORD_<ENV> no .env.backup (fora
# do git). O pg_dump 17 roda em Docker: nao precisa de Postgres instalado.
# Veja docs/backup.md.
# ===========================================================================
# $DB_URL entre aspas simples e de proposito: expande dentro do container.
# shellcheck disable=SC2016
set -euo pipefail

env="${1:?uso: db-backup.sh <dev|prod> [--if-changed]}"
mode="${2:-}"
# shellcheck source=scripts/backup/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
load_env "$env"

base="$BACKUP_DIR/$env"
mkdir -p "$base"
chmod 700 "$BACKUP_DIR" "$base"

state="$(psql_db "$base" "$(state_sql)")"
last="$(list_backups "$env" | tail -1)"
if [[ "$mode" == --if-changed && -n "$last" && -f "$last/state" && "$(cat "$last/state")" == "$state" ]]; then
  echo "==> $env: nada mudou desde o backup $(basename "$last"); pulando"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$base/$stamp"
mkdir -m 700 "$dest"
# Pasta incompleta nao pode parecer backup valido.
trap 'echo "backup falhou; removendo $dest" >&2; rm -rf "$dest"' ERR

args=()
for s in "${APP_SCHEMAS[@]}" "${PLATFORM_SCHEMAS[@]}"; do args+=(--schema="$s"); done
for t in "${EXCLUDE_DATA[@]}"; do args+=(--exclude-table-data="$t"); done

echo "==> $env: pg_dump de ${APP_SCHEMAS[*]} e dos dados de ${PLATFORM_SCHEMAS[*]}"
pg "$dest" sh -c 'pg_dump "$DB_URL" "$@" -Fc -Z 9 -f db.dump' _ "${args[@]}"

echo "==> conferindo o arquivo"
dump_counts "$dest" db.dump > "$dest/counts.tsv"
echo "$state" > "$dest/state"
(cd "$dest" && sha256sum db.dump counts.tsv state > SHA256SUMS)
chmod 600 "$dest"/*
trap - ERR

rows="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$dest/counts.tsv")"
echo "    $(wc -l < "$dest/counts.tsv") tabelas, $rows linhas, $(du -sh "$dest" | cut -f1)"

# Retencao por quantidade, nao por dias: com o --if-changed um banco parado
# fica dias sem backup novo, e contar dias apagaria justamente o unico que vale.
mapfile -t all < <(list_backups "$env")
if (( ${#all[@]} > BACKUP_KEEP )); then
  echo "==> mantendo os $BACKUP_KEEP mais recentes"
  for dir in "${all[@]:0:${#all[@]}-BACKUP_KEEP}"; do
    echo "    apagando $(basename "$dir")"
    rm -rf -- "$dir"
  done
fi

echo "==> pronto: ${dest#"$root"/}"
