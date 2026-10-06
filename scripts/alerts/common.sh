# shellcheck shell=bash disable=SC2034
# Funcoes compartilhadas pelos scripts de alertas. Nao executar direto.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mon="$root/monitoring"
config="$root/.env.alerts"
compose=(docker compose -f "$mon/docker-compose.yml")

PROMETHEUS="http://127.0.0.1:9090"
ALERTMANAGER="http://127.0.0.1:9093"
NTFY="http://127.0.0.1:8090"
TOPIC="alertas-dev"
PUSHGATEWAY="${ALERTS_PUSHGATEWAY:-http://127.0.0.1:9091}"
UNIT="saas-alertas-desktop.service"

# Valor de uma chave num arquivo KEY=VALUE (sem aspas em volta).
env_get() { # arquivo, chave
  [[ -f "$1" ]] || return 0
  sed -nE "s/^$2=[\"']?([^\"']*)[\"']?\s*$/\1/p" "$1" | tail -1
}

# Grava ou troca uma chave no .env.alerts, que fica so para o usuario.
env_set() { # chave, valor
  touch "$config"
  chmod 600 "$config"
  if grep -qE "^$1=" "$config"; then
    local tmp
    tmp="$(mktemp "$config.XXXXXX")"
    awk -v k="$1" -v v="$2" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$config" > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$config"
  else
    printf '%s=%s\n' "$1" "$2" >> "$config"
  fi
}

# Le o .env.alerts. O que ja estiver no ambiente ganha do arquivo.
load_config() {
  local key
  for key in ALERTS_SITE_URL ALERTS_SUPABASE_URL ALERTS_SUPABASE_PUBLISHABLE_KEY \
    ALERTS_SUPABASE_SECRET_KEY ALERTS_GITHUB_REPO ALERTS_GITHUB_BRANCH ALERTS_DESKTOP; do
    [[ -n "${!key:-}" ]] || printf -v "$key" '%s' "$(env_get "$config" "$key")"
  done
  ALERTS_GITHUB_BRANCH="${ALERTS_GITHUB_BRANCH:-develop}"
  ALERTS_DESKTOP="${ALERTS_DESKTOP:-1}"
}

wait_ready() { # url, nome
  local i
  for i in $(seq 1 60); do
    curl -fs --max-time 2 "$1" > /dev/null && return 0
    sleep 1
  done
  echo "$2 nao ficou pronto em 60s (make alerts-status)" >&2
  return 1
}
