#!/usr/bin/env bash
# Popula o tenant "carga" com cerca de N registros (padrao 100000), para ensaiar
# backup e restore com volume. Os donos sao a alice (owner) e o bruno
# (manager): entrando com a alice, o tenant aparece no seletor da interface.
#
#   scripts/seed-volume.sh [N]   (ou: make seed-volume N=...)
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

N="${1:-100000}"
[[ "$N" =~ ^[0-9]+$ ]] && (( N >= 1000 )) || { echo "N precisa ser um inteiro >= 1000" >&2; exit 2; }

db() {
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    psql -U postgres -d "${POSTGRES_DB:-postgres}" -X -v ON_ERROR_STOP=1 "$@"
}
user_id() { db -At -c "select id from auth.users where email = '$1'"; }

OWNER="$(user_id alice@acme.test)"
MEMBER="$(user_id bruno@acme.test)"
if [[ -z "$OWNER" || -z "$MEMBER" ]]; then
  echo "==> usuarios de demonstracao ausentes; rodando o seed de demonstracao antes"
  bash scripts/seed.sh
  OWNER="$(user_id alice@acme.test)"
  MEMBER="$(user_id bruno@acme.test)"
fi

echo "==> aplicando supabase/seed/volume.sql (N=$N)"
start=$SECONDS
db -q -v n="$N" -v owner="$OWNER" -v member="$MEMBER" < supabase/seed/volume.sql
echo "    em $((SECONDS - start))s"
echo ""
echo "Entre com alice@acme.test (senha Password123!) e troque para o tenant"
echo "\"Carga de Volume\". make fingerprint tira a foto do banco para comparar"
echo "antes do backup e depois do restore."
