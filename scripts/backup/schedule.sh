#!/usr/bin/env bash
# ===========================================================================
# Liga ou desliga o backup automatico no crontab do usuario.
#
#   scripts/backup/schedule.sh on    (ou: make backup-schedule)
#   scripts/backup/schedule.sh off   (ou: make backup-unschedule)
#
# A linha roda db-auto.sh de hora em hora; ele decide se ja passou um dia.
# ===========================================================================
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
marker="# saas-multitenant: backup do banco"
line="17 * * * * cd '$root' && scripts/backup/db-auto.sh >> backups/backup.log 2>&1 $marker"

current="$(crontab -l 2>/dev/null | grep -vF "$marker" || true)"
case "${1:-}" in
  on)
    printf '%s\n' "${current:+$current}" "$line" | sed '/^$/d' | crontab -
    echo "backup automatico ligado (de hora em hora, faz o dump se passou um dia e o banco mudou):"
    echo "  $line"
    ;;
  off)
    if [[ -n "$current" ]]; then printf '%s\n' "$current" | crontab -; else crontab -r 2>/dev/null || true; fi
    # Desligado de proposito nao e atraso: some do alerta de backup atrasado.
    for env in dev prod; do
      curl -fsS --max-time 3 -X DELETE "${ALERTS_PUSHGATEWAY:-http://127.0.0.1:9091}/metrics/job/backup/env/$env" \
        > /dev/null 2>&1 || true
    done
    echo "backup automatico desligado"
    ;;
  *)
    echo "uso: schedule.sh on|off" >&2
    exit 2
    ;;
esac
