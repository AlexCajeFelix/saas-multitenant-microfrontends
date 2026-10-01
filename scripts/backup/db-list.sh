#!/usr/bin/env bash
# ===========================================================================
# Lista os pontos de restauracao de um ambiente (ou: make backups ENV=prod).
# O nome da primeira coluna e o que `make restore FROM=...` aceita.
# ===========================================================================
set -euo pipefail

env="${1:?uso: db-list.sh <dev|prod>}"
# shellcheck source=scripts/backup/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
check_env "$env"
load_config

mapfile -t all < <(list_backups "$env")
echo "$env: ${#all[@]} backup(s), guardando os $BACKUP_KEEP mais recentes"
(( ${#all[@]} > 0 )) || exit 0

printf '  %-18s %-17s %8s %8s %6s\n' backup "hora local" tabelas linhas tamanho
for (( i = ${#all[@]} - 1; i >= 0; i-- )); do
  dir="${all[$i]}"
  name="$(basename "$dir")"
  iso="${name:0:4}-${name:4:2}-${name:6:2}T${name:9:2}:${name:11:2}:${name:13:2}Z"
  if [[ -f "$dir/counts.tsv" ]]; then
    tables="$(wc -l < "$dir/counts.tsv")"
    rows="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$dir/counts.tsv")"
  else
    tables="?"; rows="?"
  fi
  printf '  %-18s %-17s %8s %8s %6s%s\n' "$name" "$(date -d "$iso" '+%d/%m/%Y %H:%M')" "$tables" "$rows" \
    "$(du -sh "$dir" | cut -f1)" "$( (( i == ${#all[@]} - 1 )) && echo '  <- latest')"
done

last_run="$BACKUP_DIR/$env/.last-run"
[[ -f "$last_run" ]] && echo "ultima verificacao automatica: $(date -r "$last_run" '+%d/%m/%Y %H:%M')"
exit 0
