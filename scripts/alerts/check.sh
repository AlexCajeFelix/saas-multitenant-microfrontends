#!/usr/bin/env bash
# ===========================================================================
# Valida a configuracao dos alertas sem subir nada (make alerts-check, e o job
# alerts do CI): sintaxe do Prometheus, do Alertmanager e do blackbox, e os
# testes das regras (monitoring/prometheus/alertas_test.yml). Usa as mesmas
# imagens do monitoring/docker-compose.yml.
# ===========================================================================
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mon="$root/monitoring"
compose="$mon/docker-compose.yml"
image() { grep -E "^\s+image: .*$1:" "$compose" | awk '{print $2}'; }

run() { # imagem, binario, argumentos...
  local img="$1" bin="$2"; shift 2
  docker run --rm --user "$(id -u):$(id -g)" -v "$mon":/m:ro -w /m --entrypoint "$bin" "$img" "$@"
}

echo "==> prometheus: configuracao"
run "$(image prom/prometheus)" promtool check config --syntax-only prometheus/prometheus.yml
echo "==> prometheus: regras"
run "$(image prom/prometheus)" promtool check rules prometheus/alertas.yml
echo "==> prometheus: testes das regras"
run "$(image prom/prometheus)" promtool test rules prometheus/alertas_test.yml
echo "==> alertmanager"
run "$(image prom/alertmanager)" amtool check-config alertmanager/alertmanager.yml
echo "==> blackbox"
run "$(image prom/blackbox-exporter)" blackbox_exporter --config.check --config.file=blackbox/blackbox.yml
echo "==> configuracao dos alertas ok"
