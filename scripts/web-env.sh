#!/usr/bin/env bash
# Escreve web/.env.local a partir do .env da raiz.
#
# A ANON_KEY e gerada por maquina, a partir do JWT_SECRET local, entao ela nao
# pode viver no repositorio. Este script evita ter que copia-la a mao toda vez.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$root/.env"
target="$root/web/.env.local"

if [[ ! -f "$env_file" ]]; then
  echo "Nao achei o .env da raiz. Rode 'make keys' antes." >&2
  exit 1
fi

anon_key="$(grep -E '^ANON_KEY=' "$env_file" | cut -d= -f2-)"
gateway_port="$(grep -E '^GATEWAY_PORT=' "$env_file" | cut -d= -f2- || true)"
gateway_port="${gateway_port:-8000}"

if [[ -z "$anon_key" ]]; then
  echo "ANON_KEY vazia no .env. Rode 'make keys' para gerar as chaves." >&2
  exit 1
fi

cat > "$target" <<EOF
# Gerado por 'make web-env'. Nao edite: rode o alvo de novo.
VITE_API_URL=http://localhost:$gateway_port
VITE_ANON_KEY=$anon_key
EOF

echo "  web/.env.local escrito, apontando para http://localhost:$gateway_port"
