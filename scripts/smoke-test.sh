#!/usr/bin/env bash
# ===========================================================================
# Teste ponta a ponta contra o stack no ar.
#
# Percorre os cinco modulos com dois tenants distintos e termina provando o
# isolamento: o dono de um tenant nao enxerga nem escreve no outro.
# ===========================================================================
set -uo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

API="http://localhost:${GATEWAY_PORT:-8000}"
STAMP="$(date +%s)"
PASSWORD="Password123!"
EMAIL_A="smoke-a-$STAMP@acme.test"
EMAIL_B="smoke-b-$STAMP@globex.test"
EMAIL_C="smoke-c-$STAMP@acme.test"

PASSED=0
FAILED=0
BODY=""
STATUS=""

red()   { printf '\033[31m%s\033[0m' "$1"; }
green() { printf '\033[32m%s\033[0m' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

# request METODO CAMINHO TOKEN TENANT CORPO
request() {
  local method="$1" path="$2" token="${3:-}" tenant="${4:-}" body="${5:-}"
  local args=(-s -w '\n%{http_code}' -X "$method" "$API$path" -H "Content-Type: application/json")
  [[ -n "$token"  ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$tenant" ]] && args+=(-H "x-tenant-id: $tenant")
  [[ -n "$body"   ]] && args+=(-d "$body")

  local raw; raw="$(curl "${args[@]}")"
  STATUS="${raw##*$'\n'}"
  BODY="${raw%$'\n'*}"
}

# check DESCRICAO STATUS_ESPERADO
check() {
  local label="$1" expected="$2"
  if [[ "$STATUS" == "$expected" ]]; then
    printf '  %s %s\n' "$(green ' ok ')" "$label"
    PASSED=$((PASSED + 1))
  else
    printf '  %s %s (esperado %s, veio %s)\n' "$(red 'FALHA')" "$label" "$expected" "$STATUS"
    printf '        %s\n' "$(printf '%s' "$BODY" | head -c 300)"
    FAILED=$((FAILED + 1))
  fi
}

# Le um caminho pontilhado do corpo JSON da ultima resposta.
json() {
  printf '%s' "$BODY" | python3 -c '
import sys, json
try:
    node = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for key in sys.argv[1].split("."):
    if isinstance(node, list):
        node = node[int(key)] if key.isdigit() and int(key) < len(node) else None
    elif isinstance(node, dict):
        node = node.get(key)
    else:
        node = None
    if node is None:
        sys.exit(0)
print(node)
' "$1" 2>/dev/null || true
}

# json() e request() escrevem em variaveis globais, entao nao podem ser
# chamados dentro de $( ): a substituicao roda em um subshell.
signup() {
  request POST "/auth/v1/signup" "" "" "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}"
}

bold "1. Autenticacao"
signup "$EMAIL_A"; check "cadastro do usuario A" 200; TOKEN_A="$(json "access_token")"
signup "$EMAIL_B"; check "cadastro do usuario B" 200; TOKEN_B="$(json "access_token")"
signup "$EMAIL_C"; check "cadastro do usuario C" 200; TOKEN_C="$(json "access_token")"
[[ -z "$TOKEN_A" || -z "$TOKEN_B" || -z "$TOKEN_C" ]] && { red "sem token; o GoTrue respondeu?"; exit 1; }

bold "2. Modulo tenancy"
request POST "/functions/v1/tenancy/tenants" "$TOKEN_A" "" "{\"name\":\"Acme Smoke $STAMP\"}"
check "usuario A cria o tenant" 201
TENANT_A="$(json "data.id")"

request POST "/functions/v1/tenancy/tenants" "$TOKEN_B" "" "{\"name\":\"Globex Smoke $STAMP\"}"
check "usuario B cria o proprio tenant" 201
TENANT_B="$(json "data.id")"

request GET "/functions/v1/tenancy/tenants" "$TOKEN_A" ""
check "A lista os tenants em que e membro" 200

request GET "/functions/v1/tenancy/members" "$TOKEN_A" "$TENANT_A"
check "A lista os membros" 200

request POST "/functions/v1/tenancy/invitations" "$TOKEN_A" "$TENANT_A" \
  "{\"email\":\"$EMAIL_C\",\"role\":\"manager\"}"
check "A convida C como manager" 201
INVITE_TOKEN="$(json "data.token")"

request POST "/functions/v1/tenancy/invitations/accept" "$TOKEN_C" "" "{\"token\":\"$INVITE_TOKEN\"}"
check "C aceita o convite" 200

request POST "/functions/v1/tenancy/invitations/accept" "$TOKEN_B" "" "{\"token\":\"$INVITE_TOKEN\"}"
check "convite ja usado e recusado" 409

bold "3. Modulo iam"
request GET "/functions/v1/iam/whoami" "$TOKEN_A" "$TENANT_A"
check "A consulta as proprias permissoes" 200

request GET "/functions/v1/iam/permissions" "$TOKEN_A" "$TENANT_A"
check "catalogo de permissoes" 200

request POST "/functions/v1/iam/roles" "$TOKEN_A" "$TENANT_A" \
  '{"slug":"vendedor","name":"Vendedor","permissions":["crm.deal.read","crm.deal.write"]}'
check "A cria um papel do tenant" 201

request POST "/functions/v1/iam/roles" "$TOKEN_C" "$TENANT_A" \
  '{"slug":"superuser","name":"Super","permissions":["iam.role.write","tenancy.tenant.write"]}'
check "manager nao cria papel acima do proprio poder" 403

request POST "/functions/v1/iam/api-keys" "$TOKEN_A" "$TENANT_A" \
  '{"name":"Integracao","scopes":["crm.deal.read"]}'
check "A emite uma chave de API" 201

bold "4. Modulo crm"
request POST "/functions/v1/crm/companies" "$TOKEN_A" "$TENANT_A" \
  '{"name":"Padaria Sol","domain":"solsmoke.com.br","industry":"Alimentos"}'
check "cria empresa" 201
COMPANY_A="$(json "data.id")"

request POST "/functions/v1/crm/contacts" "$TOKEN_A" "$TENANT_A" \
  "{\"firstName\":\"Marina\",\"lastName\":\"Duarte\",\"email\":\"marina-$STAMP@solsmoke.com.br\",\"companyId\":\"$COMPANY_A\"}"
check "cria contato" 201
CONTACT_A="$(json "data.id")"

request POST "/functions/v1/crm/deals" "$TOKEN_A" "$TENANT_A" \
  "{\"title\":\"Sistema de PDV\",\"companyId\":\"$COMPANY_A\",\"contactId\":\"$CONTACT_A\",\"amountCents\":1850000}"
check "cria negocio" 201
DEAL_A="$(json "data.id")"

request POST "/functions/v1/crm/deals/$DEAL_A/stage" "$TOKEN_A" "$TENANT_A" '{"stageKey":"proposal"}'
check "move o negocio para proposta" 200

request POST "/functions/v1/crm/deals/$DEAL_A/stage" "$TOKEN_A" "$TENANT_A" '{"stageKey":"won"}'
check "recusa pular direto para um estagio de fechamento" 409

request POST "/functions/v1/crm/deals/$DEAL_A/activities" "$TOKEN_A" "$TENANT_A" \
  '{"kind":"meeting","subject":"Demonstracao do produto"}'
check "registra atividade" 201

request GET "/functions/v1/crm/pipeline" "$TOKEN_A" "$TENANT_A"
check "consulta o funil" 200

request POST "/functions/v1/crm/deals/$DEAL_A/win" "$TOKEN_A" "$TENANT_A" '{}'
check "marca o negocio como ganho" 200

request POST "/functions/v1/crm/deals/$DEAL_A/stage" "$TOKEN_A" "$TENANT_A" '{"stageKey":"lead"}'
check "negocio fechado nao volta a se mover" 409

bold "5. Modulo projects"
request POST "/functions/v1/projects/projects" "$TOKEN_A" "$TENANT_A" \
  "{\"name\":\"Implantacao PDV\",\"code\":\"PDV$STAMP\",\"budgetCents\":18500000}"
check "cria projeto" 201
PROJECT_A="$(json "data.id")"

request POST "/functions/v1/projects/projects/$PROJECT_A/milestones" "$TOKEN_A" "$TENANT_A" \
  '{"name":"Piloto em uma loja"}'
check "adiciona marco" 201

request POST "/functions/v1/projects/tasks" "$TOKEN_A" "$TENANT_A" \
  "{\"projectId\":\"$PROJECT_A\",\"title\":\"Configurar impressoras\",\"priority\":\"high\"}"
check "cria tarefa" 201
TASK_A="$(json "data.id")"

request POST "/functions/v1/projects/tasks" "$TOKEN_A" "$TENANT_A" \
  "{\"projectId\":\"$PROJECT_A\",\"title\":\"Testar cupom\",\"parentTaskId\":\"$TASK_A\"}"
check "cria subtarefa" 201
SUBTASK_A="$(json "data.id")"

request POST "/functions/v1/projects/tasks/$TASK_A/status" "$TOKEN_A" "$TENANT_A" '{"status":"done"}'
check "recusa concluir com subtarefa aberta" 409

request POST "/functions/v1/projects/tasks/$TASK_A/assign" "$TOKEN_A" "$TENANT_A" \
  '{"assigneeId":"00000000-0000-4000-8000-000000000001"}'
check "recusa responsavel de fora do tenant" 409

request POST "/functions/v1/projects/tasks/$SUBTASK_A/status" "$TOKEN_A" "$TENANT_A" '{"status":"done"}'
check "conclui a subtarefa" 200

request POST "/functions/v1/projects/tasks/$TASK_A/status" "$TOKEN_A" "$TENANT_A" '{"status":"done"}'
check "conclui a tarefa mae" 200

request POST "/functions/v1/projects/tasks/$TASK_A/time-entries" "$TOKEN_A" "$TENANT_A" \
  '{"minutes":180,"notes":"Configuracao"}'
check "lanca horas" 201

request POST "/functions/v1/projects/tasks/$TASK_A/comments" "$TOKEN_A" "$TENANT_A" \
  '{"body":"Concluido conforme combinado"}'
check "comenta na tarefa" 201

request GET "/functions/v1/projects/projects/$PROJECT_A/summary" "$TOKEN_A" "$TENANT_A"
check "resumo do projeto" 200

bold "6. Modulo billing"
request GET "/functions/v1/billing/plans" "$TOKEN_A" "$TENANT_A"
check "lista os planos" 200

request GET "/functions/v1/billing/subscriptions/current" "$TOKEN_A" "$TENANT_A"
check "assinatura criada no provisionamento do tenant" 200

request POST "/functions/v1/billing/subscriptions/change-plan" "$TOKEN_A" "$TENANT_A" '{"planCode":"pro"}'
check "troca de plano com rateio" 200

request POST "/functions/v1/billing/usage" "$TOKEN_A" "$TENANT_A" '{"metric":"api.calls","quantity":1250}'
check "registra consumo" 201

request GET "/functions/v1/billing/usage" "$TOKEN_A" "$TENANT_A"
check "consulta o consumo do periodo" 200

request POST "/functions/v1/billing/invoices" "$TOKEN_A" "$TENANT_A" '{"dueInDays":10,"taxCents":1495}'
check "emite fatura" 201
INVOICE_A="$(json "data.id")"

request POST "/functions/v1/billing/invoices/$INVOICE_A/pay" "$TOKEN_A" "$TENANT_A" '{}'
check "liquida a fatura" 200

request POST "/functions/v1/billing/invoices/$INVOICE_A/pay" "$TOKEN_A" "$TENANT_A" '{}'
check "fatura paga e imutavel" 409

bold "7. Isolamento entre tenants"
request GET "/functions/v1/crm/deals" "$TOKEN_B" "$TENANT_A"
check "B nao le os negocios do tenant de A" 403

request GET "/functions/v1/crm/deals/$DEAL_A" "$TOKEN_B" "$TENANT_A"
check "B nao abre um negocio de A pelo id" 403

request PATCH "/functions/v1/crm/deals/$DEAL_A" "$TOKEN_B" "$TENANT_A" '{"title":"Invadido"}'
check "B nao altera um negocio de A" 403

request GET "/functions/v1/projects/projects/$PROJECT_A" "$TOKEN_B" "$TENANT_A"
check "B nao abre um projeto de A" 403

request GET "/functions/v1/billing/invoices/$INVOICE_A" "$TOKEN_B" "$TENANT_A"
check "B nao abre uma fatura de A" 403

request GET "/functions/v1/crm/deals" "$TOKEN_B" "$TENANT_B"
check "B enxerga o proprio tenant" 200
COUNT_B="$(json "data.total")"
if [[ "${COUNT_B:-0}" == "0" ]]; then
  printf '  %s o tenant de B esta vazio, como deve estar\n' "$(green ' ok ')"
  PASSED=$((PASSED + 1))
else
  printf '  %s o tenant de B veio com %s negocios\n' "$(red 'FALHA')" "$COUNT_B"
  FAILED=$((FAILED + 1))
fi

request GET "/functions/v1/crm/deals" "$TOKEN_A" ""
check "sem x-tenant-id nao ha o que listar" 403

request GET "/functions/v1/crm/deals" "" ""
check "sem token o acesso e negado" 401

bold "8. Auditoria e eventos de dominio"
request GET "/functions/v1/tenancy/tenants/$TENANT_A" "$TOKEN_A" "$TENANT_A"
check "leitura do proprio tenant" 200

AUDIT="$(docker compose exec -T db psql -U postgres -tAc \
  "select count(*) from core.audit_logs where tenant_id = '$TENANT_A'" 2>/dev/null | tr -d '[:space:]')"
EVENTS="$(docker compose exec -T db psql -U postgres -tAc \
  "select count(*) from core.domain_events where tenant_id = '$TENANT_A'" 2>/dev/null | tr -d '[:space:]')"
printf '  %s %s registros de auditoria, %s eventos de dominio\n' "$(green ' ok ')" "${AUDIT:-0}" "${EVENTS:-0}"

echo ""
bold "Resultado"
printf '  %s aprovados, %s falhas\n\n' "$(green "$PASSED")" "$([[ $FAILED -gt 0 ]] && red "$FAILED" || green "0")"
[[ $FAILED -gt 0 ]] && exit 1
exit 0
