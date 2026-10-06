#!/usr/bin/env bash
# ===========================================================================
# Grava a chave secreta do projeto dev (make alerts-key), que libera a Metrics
# API do Supabase: disco, conexoes, CPU, memoria e modo somente leitura.
#
# A chave sai de Project Settings > API Keys > Secret keys (sb_secret_...). Da
# para criar uma so para isto e revogar quando quiser. Ela e pedida sem eco,
# conferida contra a API e guardada no .env.alerts (600, fora do git).
# Sem terminal: ALERTS_SUPABASE_SECRET_KEY=sb_secret_... make alerts-key
# ===========================================================================
set -euo pipefail

# shellcheck source=scripts/alerts/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
key="${ALERTS_SUPABASE_SECRET_KEY:-}"
load_config
supabase="${ALERTS_SUPABASE_URL%/}"
[[ -n "$supabase" ]] || { echo "rode make alerts-up antes (ele preenche o .env.alerts)" >&2; exit 2; }

if [[ -z "$key" && -t 0 ]]; then
  read -rsp "Chave secreta do projeto dev (sb_secret_...): " key
  echo
fi
[[ -n "$key" ]] || { echo "nenhuma chave informada" >&2; exit 2; }

# A chave vai para o curl pela entrada padrao, nunca pela linha de comando.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -K - "$supabase/customer/v1/privileged/metrics" \
  <<< "user = \"service_role:$key\"")"
case "$code" in
  200) ;;
  401 | 403) echo "a Metrics API recusou a chave (HTTP $code). Confira se e a secreta do projeto dev." >&2; exit 1 ;;
  *) echo "a Metrics API nao respondeu como esperado (HTTP $code). O projeto esta pausado?" >&2; exit 1 ;;
esac
env_set ALERTS_SUPABASE_SECRET_KEY "$key"
echo "chave conferida e guardada no .env.alerts"
exec "$root/scripts/alerts/up.sh"
