#!/usr/bin/env bash
# Cria os usuarios de demonstracao no GoTrue e aplica o seed com os ids deles.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

API="http://localhost:${GATEWAY_PORT:-8000}"
PASSWORD="Password123!"

# Cria o usuario, ou reaproveita o que ja existe, e devolve o id.
ensure_user() {
  local email="$1"
  local created
  created="$(curl -s -X POST "$API/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"email_confirm\":true}")"

  local id
  id="$(printf '%s' "$created" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
  if [[ -n "$id" ]]; then
    printf '%s' "$id"
    return
  fi

  # Ja existia: procura pelo e-mail na listagem administrativa.
  curl -s "$API/auth/v1/admin/users?per_page=200" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" |
    python3 -c "
import sys, json
alvo = '$email'
dados = json.load(sys.stdin)
for u in dados.get('users', dados if isinstance(dados, list) else []):
    if u.get('email') == alvo:
        print(u['id']); break
"
}

echo "==> criando usuarios de demonstracao"
OWNER_A="$(ensure_user alice@acme.test)"
MEMBER_A="$(ensure_user bruno@acme.test)"
OWNER_B="$(ensure_user carla@globex.test)"
MEMBER_B="$(ensure_user diego@globex.test)"

for pair in "alice@acme.test:$OWNER_A" "bruno@acme.test:$MEMBER_A" \
            "carla@globex.test:$OWNER_B" "diego@globex.test:$MEMBER_B"; do
  email="${pair%%:*}"; id="${pair##*:}"
  if [[ -z "$id" ]]; then
    echo "nao consegui obter o id de $email" >&2
    exit 1
  fi
  printf '    %-22s %s\n' "$email" "$id"
done

echo "==> aplicando supabase/seed/demo.sql"
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  psql -U postgres -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1 \
    -v owner_a="$OWNER_A" -v member_a="$MEMBER_A" \
    -v owner_b="$OWNER_B" -v member_b="$MEMBER_B" \
  < supabase/seed/demo.sql

echo ""
echo "Usuarios de demonstracao (senha: $PASSWORD)"
echo "  alice@acme.test    owner   do tenant acme"
echo "  bruno@acme.test    manager do tenant acme"
echo "  carla@globex.test  owner   do tenant globex"
echo "  diego@globex.test  member  do tenant globex"
