#!/usr/bin/env bash
# ===========================================================================
# Backup do Postgres de um projeto Supabase numa pasta local.
#
#   scripts/backup/db-backup.sh <dev|prod>        (ou: make backup ENV=prod)
#
# Gera backups/<env>/<data UTC>/ com:
#   app.dump       schemas da aplicacao, estrutura + dados (pg_dump -Fc)
#   platform.dump  dados de auth (usuarios, identidades...) e o historico de
#                  migrations; a estrutura desses schemas e do Supabase
#   counts.tsv     linhas por tabela, contadas no proprio dump
#   SHA256SUMS     integridade dos arquivos (o restore confere)
# e apaga as pastas com mais de BACKUP_KEEP_DAYS dias (padrao 30).
#
# Conexao: SUPABASE_REF_<ENV> e SUPABASE_DB_PASSWORD_<ENV> no .env.backup (fora
# do git). O pg_dump 17 roda em Docker: nao precisa de Postgres instalado.
# Veja docs/backup.md.
# ===========================================================================
# $DB_URL entre aspas simples e de proposito: expande dentro do container.
# shellcheck disable=SC2016
set -euo pipefail

env="${1:?uso: db-backup.sh <dev|prod>}"
# shellcheck source=scripts/backup/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
load_env "$env"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$BACKUP_DIR/$env/$stamp"
mkdir -p "$dest"
chmod 700 "$BACKUP_DIR" "$BACKUP_DIR/$env" "$dest"
# Pasta incompleta nao pode parecer backup valido.
trap 'echo "backup falhou; removendo $dest" >&2; rm -rf "$dest"' ERR

echo "==> $env: conferindo a conexao"
psql_db "$dest" "select 'postgres ' || current_setting('server_version') || ', ' || pg_size_pretty(pg_database_size(current_database()))" |
  sed 's/^/    /'

schema_args=(); for s in "${APP_SCHEMAS[@]}"; do schema_args+=(--schema="$s"); done
platform_args=(); for s in "${PLATFORM_SCHEMAS[@]}"; do platform_args+=(--schema="$s"); done
for t in "${PLATFORM_EXCLUDE[@]}"; do platform_args+=(--exclude-table="$t"); done

echo "==> app.dump (${APP_SCHEMAS[*]})"
pg "$dest" sh -c 'pg_dump "$DB_URL" "$@" -Fc -Z 9 -f app.dump' _ "${schema_args[@]}"

echo "==> platform.dump (dados de ${PLATFORM_SCHEMAS[*]})"
pg "$dest" sh -c 'pg_dump "$DB_URL" "$@" -Fc -Z 9 --data-only -f platform.dump' _ "${platform_args[@]}"

echo "==> conferindo os arquivos"
{ dump_counts "$dest" platform.dump; dump_counts "$dest" app.dump; } > "$dest/counts.tsv"
objects="$(pg "$dest" pg_restore -l app.dump | grep -c '^[0-9]')"
(cd "$dest" && sha256sum app.dump platform.dump counts.tsv > SHA256SUMS)
chmod 600 "$dest"/*
trap - ERR

rows="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$dest/counts.tsv")"
tables="$(wc -l < "$dest/counts.tsv")"
echo "    $objects objetos, $tables tabelas, $rows linhas, $(du -sh "$dest" | cut -f1)"

keep="${BACKUP_KEEP_DAYS:-30}"
old="$(find "$BACKUP_DIR/$env" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' -mtime +"$keep" | sort)"
if [[ -n "$old" ]]; then
  echo "==> apagando backups com mais de $keep dias"
  while read -r dir; do echo "    $(basename "$dir")"; rm -rf -- "$dir"; done <<< "$old"
fi

echo "==> pronto: ${dest#"$root"/}"
