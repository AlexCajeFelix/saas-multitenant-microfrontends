#!/usr/bin/env bash
# ===========================================================================
# Backup automatico, como o diario do plano Pro, mas local e de graca.
#
# O cron chama de hora em hora (scripts/backup/schedule.sh on). Para cada
# ambiente de BACKUP_ENVS (padrao: prod dev), se a ultima verificacao tem mais
# de BACKUP_INTERVAL_HOURS (padrao 24), roda db-backup.sh --if-changed: faz o
# dump so se o banco mudou. Chamar de hora em hora, e nao uma vez por dia, faz
# o backup acontecer mesmo que a maquina estivesse desligada no horario.
#
# Se falhar (sem internet, projeto pausado pelo plano free), nao marca a
# verificacao e tenta de novo na hora seguinte. Tudo vai para backups/backup.log.
# ===========================================================================
set -uo pipefail

# shellcheck source=scripts/backup/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
load_config
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Uma execucao por vez: um dump grande pode passar de uma hora.
exec 9> "$BACKUP_DIR/.auto.lock"
flock -n 9 || exit 0

interval=$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
for env in ${BACKUP_ENVS:-prod dev}; do
  mark="$BACKUP_DIR/$env/.last-run"
  if [[ -f "$mark" ]] && (( $(date +%s) - $(stat -c %Y "$mark") < interval )); then
    continue
  fi
  echo "[$(date '+%F %T')] $env"
  if "$root/scripts/backup/db-backup.sh" "$env" --if-changed 2>&1; then
    touch "$mark"
  else
    echo "[$(date '+%F %T')] $env: FALHOU, tento de novo na proxima hora"
  fi
done
