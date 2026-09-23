#!/usr/bin/env bash
# ===========================================================================
# Etapa de banco do deploy.
#
#   scripts/deploy/supabase-deploy.sh <project-ref>
#
# SUPABASE_DEPLOY_MODE decide quem aplica migrations e Edge Functions:
#   integration (padrao)  a integracao GitHub do Supabase ja esta aplicando o
#                         mesmo push; aqui so esperamos o banco chegar na
#                         ultima migration do repositorio;
#   cli                   o proprio pipeline aplica (`db push` e
#                         `functions deploy`), para quando a integracao nao
#                         estiver ligada naquele projeto.
#
# Depois, nos dois modos: expoe os schemas dos modulos na API (a integracao nao
# aplica o [api] do config.toml) e espera o banco na versao certa.
#
# Ambiente: SUPABASE_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY.
# ===========================================================================
set -euo pipefail

ref="${1:?project ref}"
mode="${SUPABASE_DEPLOY_MODE:-integration}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

: "${SUPABASE_ACCESS_TOKEN:?defina SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_URL:?defina SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?defina SUPABASE_ANON_KEY}"
SUPABASE_URL="${SUPABASE_URL%/}"
timeout="${MIGRATION_TIMEOUT:-600}"
supabase() { pnpm exec supabase "$@"; }

expected="$("$root/scripts/deploy/latest-migration.sh")"
functions=(tenancy iam crm projects billing)

if [[ "$mode" == "cli" ]]; then
  echo "==> modo cli: aplicando migrations e funcoes pelo pipeline"
  supabase link --project-ref "$ref" ${SUPABASE_DB_PASSWORD:+--password "$SUPABASE_DB_PASSWORD"} >/dev/null
  supabase db push --linked --include-all
  for fn in "${functions[@]}"; do
    supabase functions deploy "$fn" --project-ref "$ref" --no-verify-jwt --use-api
  done
else
  echo "==> modo integration: a integracao GitHub do Supabase aplica este push"
fi

echo "==> expondo os schemas dos modulos na API"
curl -fsS -X PATCH "https://api.supabase.com/v1/projects/$ref/postgrest" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"db_schema":"public,graphql_public,core,iam,crm,projects,billing","db_extra_search_path":"public,extensions"}' \
  >/dev/null

echo "==> esperando o banco chegar na migration $expected (ate ${timeout}s)"
deadline=$(( $(date +%s) + timeout ))
while :; do
  got="$(curl -fsS --max-time 10 -X POST "$SUPABASE_URL/rest/v1/rpc/schema_version" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{}' 2>/dev/null | tr -d '"' || true)"
  # ">=" e nao "==": num rollback (ref antigo) o banco continua na frente,
  # porque migration nao volta. Atras e que nunca pode estar.
  if [[ "$got" =~ ^[0-9]+$ ]] && (( 10#$got >= 10#$expected )); then
    echo "    banco na migration $got"
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "::error::O banco nao chegou na migration $expected (esta em '${got:-desconhecida}'). A integracao GitHub do Supabase esta ligada para esta branch? Veja Project Settings > Integrations, ou use SUPABASE_DEPLOY_MODE=cli."
    exit 1
  fi
  echo "    ainda em '${got:-sem resposta}', aguardando..."
  sleep 15
done

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "### Supabase ($mode): banco na migration \`$expected\`" >> "$GITHUB_STEP_SUMMARY"
fi
