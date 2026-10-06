#!/usr/bin/env bash
# ===========================================================================
# Manda um alerta de teste pelo caminho inteiro (make alerts-test):
# Alertmanager -> ntfy -> notificacao do desktop. Confere que chegou no ntfy.
# O alerta vale 2 min; o "resolvido" chega uns 5 min depois.
# ===========================================================================
set -euo pipefail

# shellcheck source=scripts/alerts/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
curl -fs --max-time 3 "$ALERTMANAGER/-/ready" > /dev/null || { echo "Alertmanager fora do ar: make alerts-up" >&2; exit 1; }

now="$(date -u +%s)"
iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
jq -n --arg starts "$(iso "$now")" --arg ends "$(iso $((now + 120)))" --arg id "$now" '[{
  labels: { alertname: "TesteDeAlerta", severity: "warning", area: "teste", ambiente: "dev", teste: $id },
  annotations: {
    titulo: "Teste de alerta",
    summary: "Se esta mensagem chegou, os alertas do dev chegam aqui",
    description: "Disparado por make alerts-test. Resolve sozinho em 2 min."
  },
  startsAt: $starts, endsAt: $ends
}]' | curl -fsS --max-time 5 -H 'Content-Type: application/json' --data-binary @- "$ALERTMANAGER/api/v2/alerts" > /dev/null

echo "==> alerta de teste enviado; o Alertmanager espera 30s para agrupar"
for _ in $(seq 1 60); do
  got="$(curl -fs --max-time 5 "$NTFY/$TOPIC/json?poll=1&since=$now" | jq -rs 'map(select(.title | test("Teste de alerta"))) | last | .title // empty')"
  if [[ -n "$got" ]]; then
    echo "==> chegou: \"$got\" em $NTFY/$TOPIC"
    if systemctl --user is-active --quiet "$UNIT" 2> /dev/null; then
      echo "    e na notificacao do desktop"
    fi
    exit 0
  fi
  sleep 2
done
echo "nao chegou no ntfy em 2 min. Veja: make alerts-status e docker logs alertas_alertmanager" >&2
exit 1
