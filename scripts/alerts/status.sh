#!/usr/bin/env bash
# ===========================================================================
# O que esta sendo vigiado e o que esta disparando (make alerts-status).
# ===========================================================================
set -euo pipefail

# shellcheck source=scripts/alerts/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

echo "==> containers"
"${compose[@]}" ps --format '  {{.Service}}\t{{.State}}\t{{.Status}}' | column -t -s $'\t'

echo "==> desktop"
if systemctl --user is-active --quiet "$UNIT" 2> /dev/null; then
  echo "  $UNIT ativo"
else
  echo "  $UNIT parado (make alerts-up instala)"
fi

curl -fs --max-time 3 "$PROMETHEUS/-/ready" > /dev/null || { echo "Prometheus fora do ar: make alerts-up" >&2; exit 1; }

echo "==> alvos (ultima coleta)"
curl -fs "$PROMETHEUS/api/v1/targets?state=active" | jq -r '
  .data.activeTargets | sort_by(.labels.job, .labels.instance)[]
  | [.labels.job, .labels.instance, (if .health == "up" then "ok" else .health end), (.lastError // "")] | @tsv' |
  column -t -s $'\t' | sed 's/^/  /'

echo "==> sondas falhando agora"
failing="$(curl -fs "$PROMETHEUS/api/v1/query" --data-urlencode 'query=probe_success == 0' |
  jq -r '.data.result[] | "  \(.metric.job) \(.metric.instance)"')"
echo "${failing:-  nenhuma}"

echo "==> alertas disparando"
firing="$(curl -fs "$ALERTMANAGER/api/v2/alerts?active=true" |
  jq -r '.[] | "  \(.labels.severity)\t\(.labels.alertname)\t\(.annotations.summary // "")\(if .status.state == "suppressed" then " (silenciado)" else "" end)"')"
if [[ -n "$firing" ]]; then column -t -s $'\t' <<< "$firing"; else echo "  nenhum"; fi

echo "==> pendentes (ainda no prazo do for:)"
pending="$(curl -fs "$PROMETHEUS/api/v1/alerts" | jq -r '.data.alerts[] | select(.state == "pending") | "  \(.labels.alertname) \(.labels.instance // "")"')"
echo "${pending:-  nenhum}"
