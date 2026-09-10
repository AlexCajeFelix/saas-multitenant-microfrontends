#!/usr/bin/env bash
# Espera o gateway responder antes de devolver o controle ao Makefile.
set -euo pipefail

PORT="${GATEWAY_PORT:-8000}"
if [[ -f .env ]]; then
  PORT="$(grep -E '^GATEWAY_PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || true)"
  PORT="${PORT:-8000}"
fi

URL="http://localhost:${PORT}/functions/v1/tenancy/health"
echo -n "aguardando ${URL} "
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$URL" 2>/dev/null; then
    echo " pronto"
    exit 0
  fi
  echo -n "."
  sleep 2
done
echo ""
echo "gateway nao respondeu a tempo; veja 'docker compose logs functions gateway'" >&2
exit 1
