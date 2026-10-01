# shellcheck shell=bash disable=SC2016,SC2034
# Funcoes compartilhadas por db-backup.sh e db-restore.sh. Nao executar direto.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Schemas da aplicacao (estrutura + dados). Os do Supabase (auth, storage,
# realtime...) pertencem a plataforma: deles so entram os dados que a
# aplicacao usa, em platform.dump.
APP_SCHEMAS=(public core iam crm projects billing)

# Dados da plataforma que fazem parte do estado da aplicacao: usuarios do Auth
# (core.memberships aponta para auth.users) e o historico de migrations (o
# health check e o drift leem dele). auth.schema_migrations e do GoTrue e
# acompanha a versao dele, nao o backup.
PLATFORM_SCHEMAS=(auth supabase_migrations)
PLATFORM_EXCLUDE=(auth.schema_migrations)

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

# Le o .env.backup (ou o ambiente) e exporta DB_URL e PGPASSWORD do projeto.
# Mesmos nomes das variaveis e secrets do GitHub: SUPABASE_REF_<ENV> e
# SUPABASE_DB_PASSWORD_<ENV>. A conexao e pelo pooler em modo sessao (IPv4; o
# host direto db.<ref>.supabase.co e so IPv6 no plano free).
load_env() {
  local env="$1"
  [[ "$env" =~ ^(dev|prod)$ ]] || { echo "ambiente invalido: '$env' (use dev ou prod; homol e staging usam o banco de dev)" >&2; exit 2; }
  if [[ -f "$root/.env.backup" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env.backup"
    set +a
  fi
  local ref_var="SUPABASE_REF_${env^^}" pass_var="SUPABASE_DB_PASSWORD_${env^^}"
  REF="${!ref_var:-}"
  PGPASSWORD="${!pass_var:-}"
  [[ -n "$REF" && -n "$PGPASSWORD" ]] || { echo "defina $ref_var e $pass_var no .env.backup (veja docs/backup.md)" >&2; exit 2; }
  DB_URL="postgresql://postgres.$REF@${BACKUP_POOLER_HOST:-aws-0-sa-east-1.pooler.supabase.com}:5432/postgres?sslmode=require"
  export DB_URL PGPASSWORD
  BACKUP_DIR="${BACKUP_DIR:-$root/backups}"
  [[ "$BACKUP_DIR" = /* ]] || BACKUP_DIR="$root/$BACKUP_DIR"
}

# Roda um comando do cliente Postgres 17 em Docker. A senha vai por variavel de
# ambiente, nunca na linha de comando (nao aparece no `ps`). $1 e a pasta
# montada em /backup; WORK, se definido, e montada em /work.
pg() {
  local dir="$1"; shift
  docker run --rm -i --network host \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -e DB_URL -e PGPASSWORD -e PGAPPNAME=db-backup \
    -v "$dir":/backup ${WORK:+-v "$WORK":/work} -w /backup \
    "$PG_IMAGE" "$@"
}

psql_db() { # dir, sql
  pg "$1" sh -c 'psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -At' <<< "$2"
}

# Linhas por tabela contadas no proprio dump (uma linha por registro no COPY):
# prova que o arquivo le de ponta a ponta e da o numero que o restore confere.
dump_counts() { # dir, arquivo
  pg "$1" pg_restore --data-only -f - "$2" | awk '
    /^COPY / { table = $2; n = 0; inside = 1; next }
    inside && /^\\\.$/ { print table "\t" n; inside = 0; next }
    inside { n++ }'
}
