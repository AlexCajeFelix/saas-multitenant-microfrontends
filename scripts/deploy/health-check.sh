#!/usr/bin/env bash
# ===========================================================================
# Health check do deploy: garante que SUBIU A VERSAO CERTA, nao so que responde.
#
#   scripts/deploy/health-check.sh <url-publica-do-shell> <sha-esperado>
#
# Tudo e conferido pela URL publica do shell, o mesmo caminho do usuario:
#   1. /version.json do shell e /_zones/<zona>/version.json de cada zona trazem
#      o commit esperado (prova tambem que os rewrites shell -> zona funcionam);
#   2. uma rota de pagina de cada zona devolve o HTML da propria zona;
#   3. o Auth do Supabase responde;
#   4. o banco esta na ultima migration do repositorio (rpc/schema_version);
#   5. as cinco Edge Functions respondem /health.
#
# Repete ate HEALTH_TIMEOUT segundos (padrao 300): alias e CDN levam alguns
# segundos para convergir, e o deploy do Supabase pode estar terminando.
#
# Ambiente: SUPABASE_URL, SUPABASE_ANON_KEY.
# ===========================================================================
set -uo pipefail

base="${1:?url publica do shell}"
expected="${2:?sha esperado}"
base="${base%/}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
timeout="${HEALTH_TIMEOUT:-300}"
deadline=$(( $(date +%s) + timeout ))

: "${SUPABASE_URL:?defina SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?defina SUPABASE_ANON_KEY}"
SUPABASE_URL="${SUPABASE_URL%/}"

expected_schema="$("$root/scripts/deploy/latest-migration.sh")"

zones=(tenancy iam crm projects billing)
declare -A page=(
  [tenancy]=/tenancy/membros [iam]=/iam/papeis [crm]=/crm/funil
  [projects]=/projetos [billing]=/billing/assinatura
)

failures=()
check() { # descricao, comando...
  local name="$1"; shift
  if "$@"; then
    printf '  \033[32mok\033[0m    %s\n' "$name"
  else
    printf '  \033[31mfalha\033[0m %s\n' "$name"
    failures+=("$name")
  fi
}

version_is() {
  local got
  got="$(curl -fsS --max-time 10 "$1" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).version??""))}catch{}})')"
  [[ "$got" == "$expected" ]]
}
page_is_zone() { curl -fsS --max-time 10 "$base$1" 2>/dev/null | grep -q "/_zones/$2/"; }
auth_ok() { curl -fsS --max-time 10 "$SUPABASE_URL/auth/v1/health" -H "apikey: $SUPABASE_ANON_KEY" >/dev/null 2>&1; }
schema_ok() {
  local got
  got="$(curl -fsS --max-time 10 -X POST "$SUPABASE_URL/rest/v1/rpc/schema_version" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{}' 2>/dev/null | tr -d '"')"
  # Pelo menos na versao do commit: num rollback o banco fica na frente.
  [[ "$got" =~ ^[0-9]+$ ]] && (( 10#$got >= 10#$expected_schema ))
}
function_ok() { curl -fsS --max-time 20 "$SUPABASE_URL/functions/v1/$1/health" >/dev/null 2>&1; }

attempt=0
while :; do
  attempt=$((attempt + 1))
  failures=()
  echo "==> tentativa $attempt: $base (commit $expected, schema $expected_schema)"
  check "shell /version.json = $expected" version_is "$base/version.json"
  for zone in "${zones[@]}"; do
    check "$zone /_zones/$zone/version.json = $expected" version_is "$base/_zones/$zone/version.json"
    check "$zone ${page[$zone]} serve o bundle da zona" page_is_zone "${page[$zone]}" "$zone"
  done
  check "supabase auth /health" auth_ok
  check "supabase schema_version >= $expected_schema" schema_ok
  for fn in "${zones[@]}"; do
    check "edge function $fn /health" function_ok "$fn"
  done

  if [[ ${#failures[@]} -eq 0 ]]; then
    echo "==> saudavel: todas as verificacoes passaram"
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      {
        echo "### Health check ok"
        echo "- URL: $base"
        echo "- Commit \`$expected\` no shell e nas 5 zonas"
        echo "- Banco na migration \`$expected_schema\`, 5 Edge Functions respondendo"
      } >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 0
  fi

  if (( $(date +%s) >= deadline )); then
    echo "==> NAO saudavel apos ${timeout}s. Falhando:" >&2
    printf '     - %s\n' "${failures[@]}" >&2
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      { echo "### Health check falhou"; printf -- '- %s\n' "${failures[@]}"; } >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 1
  fi
  sleep 10
done
