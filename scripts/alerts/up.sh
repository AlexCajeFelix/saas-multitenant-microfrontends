#!/usr/bin/env bash
# ===========================================================================
# Sobe os alertas do ambiente dev nesta maquina (make alerts-up). Pode rodar de
# novo a qualquer hora: regera os alvos e recarrega a configuracao.
#
#   1. .env.alerts: na primeira vez, preenchido com o environment dev do
#      GitHub (as mesmas variaveis do deploy), pelo gh;
#   2. chave secreta do projeto, para as metricas do banco (opcional);
#   3. monitoring/targets/*.yml, os alvos que o Prometheus sonda;
#   4. docker compose up, e recarga do Prometheus e do Alertmanager;
#   5. hora do ultimo backup do dev, para o alerta de backup atrasado;
#   6. servico do usuario que leva os alertas para a notificacao do desktop.
# ===========================================================================
set -euo pipefail

# shellcheck source=scripts/alerts/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
command -v jq > /dev/null || { echo "precisa do jq (apt install jq)" >&2; exit 2; }
load_config

# --- 1. configuracao ---------------------------------------------------------
gh_var() { # caminho na API do GitHub
  gh api "repos/$ALERTS_GITHUB_REPO/$1" --jq .value 2> /dev/null
}
if [[ -z "$ALERTS_GITHUB_REPO" ]]; then
  ALERTS_GITHUB_REPO="$(git -C "$root" remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
  env_set ALERTS_GITHUB_REPO "$ALERTS_GITHUB_REPO"
fi
if [[ -z "$ALERTS_SUPABASE_URL" || -z "$ALERTS_SUPABASE_PUBLISHABLE_KEY" || -z "$ALERTS_SITE_URL" ]]; then
  command -v gh > /dev/null || { echo "preencha o .env.alerts (veja .env.alerts.example) ou instale o gh" >&2; exit 2; }
  echo "==> lendo o environment dev de $ALERTS_GITHUB_REPO no GitHub"
  if [[ -z "$ALERTS_SUPABASE_URL" ]]; then
    ALERTS_SUPABASE_URL="$(gh_var environments/dev/variables/SUPABASE_URL)"
    env_set ALERTS_SUPABASE_URL "$ALERTS_SUPABASE_URL"
  fi
  if [[ -z "$ALERTS_SUPABASE_PUBLISHABLE_KEY" ]]; then
    ALERTS_SUPABASE_PUBLISHABLE_KEY="$(gh_var environments/dev/variables/SUPABASE_ANON_KEY)"
    env_set ALERTS_SUPABASE_PUBLISHABLE_KEY "$ALERTS_SUPABASE_PUBLISHABLE_KEY"
  fi
  if [[ -z "$ALERTS_SITE_URL" ]]; then
    prefix="$(gh_var actions/variables/VERCEL_ALIAS_PREFIX)"
    [[ -n "$prefix" ]] && ALERTS_SITE_URL="https://$(VERCEL_ALIAS_PREFIX="$prefix" node "$root/scripts/deploy/hosts.mjs" shell dev)"
    env_set ALERTS_SITE_URL "$ALERTS_SITE_URL"
  fi
fi
for v in ALERTS_SITE_URL ALERTS_SUPABASE_URL ALERTS_SUPABASE_PUBLISHABLE_KEY; do
  [[ -n "${!v}" ]] || { echo "faltou $v no .env.alerts (veja .env.alerts.example)" >&2; exit 2; }
done
site="${ALERTS_SITE_URL%/}"
supabase="${ALERTS_SUPABASE_URL%/}"
key="$ALERTS_SUPABASE_PUBLISHABLE_KEY"

# --- 2. chave secreta (metricas do banco) --------------------------------------
# Ordem: .env.alerts (make alerts-key), a chave do .env.backup, ou um token
# pessoal (sbp_...) no .env.backup, com o qual a Management API entrega a chave.
secret="$ALERTS_SUPABASE_SECRET_KEY"
[[ -n "$secret" ]] || secret="$(env_get "$root/.env.backup" SUPABASE_SECRET_KEY_DEV)"
token="${SUPABASE_ACCESS_TOKEN:-$(env_get "$root/.env.backup" SUPABASE_ACCESS_TOKEN)}"
if [[ -z "$secret" && -n "$token" ]]; then
  ref="$(sed -E 's#^https://([a-z0-9]+)\.supabase\.co.*#\1#' <<< "$supabase")"
  secret="$(curl -fsS --max-time 15 -K - "https://api.supabase.com/v1/projects/$ref/api-keys?reveal=true" \
    <<< "header = \"Authorization: Bearer $token\"" 2> /dev/null |
    jq -r '[.[] | select(.disabled != true) | select(.type == "secret" or .name == "service_role")]
           | sort_by(.type != "secret") | first | .api_key // empty')" || secret=""
fi
# O Prometheus roda como nobody no container: o arquivo e legivel (644), mas a
# pasta e so do usuario (700), e o container nao passa por ela.
install -d -m 700 "$mon/secrets"
install -m 644 /dev/null "$mon/secrets/supabase-secret-key"
printf '%s' "$secret" > "$mon/secrets/supabase-secret-key"

# --- 3. alvos -------------------------------------------------------------------
# Mesmas rotas do health check do deploy (scripts/deploy/health-check.sh).
zones=(tenancy iam crm projects billing)
declare -A page=(
  [tenancy]=/tenancy/membros [iam]=/iam/papeis [crm]=/crm/funil
  [projects]=/projetos [billing]=/billing/assinatura
)
target() { # url, alvo, modulo, url sem a chave
  printf -- '- targets: ["%s"]\n  labels: { alvo: "%s", url: "%s", __param_module: "%s" }\n' "$1" "$2" "${4:-$1}" "$3"
}
targets="$mon/targets"
mkdir -p "$targets"
{
  target "$site/" shell shell
  for z in "${zones[@]}"; do target "$site${page[$z]}" "$z" zona; done
} > "$targets/site.yml"
{
  target "$supabase/auth/v1/health?apikey=$key" auth supabase_auth "$supabase/auth/v1/health"
  target "$supabase/rest/v1/rpc/schema_version?apikey=$key" rest supabase_rest "$supabase/rest/v1/rpc/schema_version"
} > "$targets/supabase-api.yml"
for z in "${zones[@]}"; do target "$supabase/functions/v1/$z/health" "$z" edge_function; done > "$targets/edge-functions.yml"
printf -- '- targets: ["%s"]\n  labels: { alvo: github }\n' \
  "https://api.github.com/repos/$ALERTS_GITHUB_REPO/actions/workflows/deploy.yml/runs?branch=$ALERTS_GITHUB_BRANCH&per_page=1" \
  > "$targets/deploy.yml"
if [[ -n "$secret" ]]; then
  printf -- '- targets: ["%s:443"]\n  labels: { alvo: banco }\n' "${supabase#https://}" > "$targets/supabase-metrics.yml"
else
  echo "[]" > "$targets/supabase-metrics.yml"
fi

# --- 4. stack -------------------------------------------------------------------
echo "==> subindo o monitoramento (monitoring/docker-compose.yml)"
"${compose[@]}" up -d --quiet-pull
wait_ready "$PROMETHEUS/-/ready" Prometheus
wait_ready "$ALERTMANAGER/-/ready" Alertmanager
wait_ready "$NTFY/v1/health" ntfy
# Se ja estava no ar, passa a valer a configuracao nova.
curl -fsS -X POST "$PROMETHEUS/-/reload" > /dev/null
curl -fsS -X POST "$ALERTMANAGER/-/reload" > /dev/null

# --- 5. backup ------------------------------------------------------------------
# A hora do ultimo backup conferido e o .last-run de cada ambiente. Sem isto, o
# alerta de atraso so valeria depois do proximo backup. So com o backup
# automatico ligado: desligado de proposito, nao e atraso.
if crontab -l 2> /dev/null | grep -qF '# saas-multitenant: backup do banco'; then
  backup_dir="$(env_get "$root/.env.backup" BACKUP_DIR)"
  backup_dir="${backup_dir:-backups}"
  [[ "$backup_dir" = /* ]] || backup_dir="$root/$backup_dir"
  for env in dev prod; do
    mark="$backup_dir/$env/.last-run"
    [[ -f "$mark" ]] || continue
    printf 'backup_ultimo_ok_timestamp_seconds %s\n' "$(stat -c %Y "$mark")" |
      curl -fsS --max-time 3 --data-binary @- "$PUSHGATEWAY/metrics/job/backup/env/$env" > /dev/null || true
  done
fi

# --- 6. desktop -----------------------------------------------------------------
desktop="desligada (ALERTS_DESKTOP=0)"
if [[ "$ALERTS_DESKTOP" != 0 ]]; then
  if command -v notify-send > /dev/null && systemctl --user show-environment > /dev/null 2>&1; then
    unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$unit_dir"
    cat > "$unit_dir/$UNIT" << EOF
[Unit]
Description=Alertas do ambiente dev no desktop (ntfy local -> notify-send)
Documentation=file://$root/docs/alertas.md

[Service]
ExecStart="$root/scripts/alerts/desktop.sh"
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --quiet "$UNIT"
    systemctl --user restart "$UNIT"
    desktop="ligada (servico $UNIT)"
  else
    desktop="indisponivel (sem notify-send ou systemd do usuario)"
  fi
fi

echo ""
echo "  alertas do dev no ar"
echo "  caixa de entrada  $NTFY/$TOPIC"
echo "  notificacao       $desktop"
echo "  alertas ativos    $ALERTMANAGER"
echo "  regras e alvos    $PROMETHEUS/alerts"
if [[ -z "$secret" ]]; then
  echo ""
  echo "  sem a chave secreta do projeto: as metricas do banco (disco, conexoes,"
  echo "  modo somente leitura) ficam de fora. Para ligar: make alerts-key"
fi
echo ""
echo "  make alerts-test    manda um alerta de teste ate aqui"
echo "  make alerts-status  o que esta sendo vigiado e o que esta disparando"
echo ""
