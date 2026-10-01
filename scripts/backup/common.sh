# shellcheck shell=bash disable=SC2016,SC2034
# Funcoes compartilhadas pelos scripts de backup. Nao executar direto.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Schemas da aplicacao: estrutura + dados.
APP_SCHEMAS=(public core iam crm projects billing)
# Schemas do Supabase dos quais so os DADOS fazem parte do estado da aplicacao:
# usuarios do Auth (core.memberships aponta para auth.users) e o historico de
# migrations (o health check e o drift leem dele). A estrutura e da plataforma.
PLATFORM_SCHEMAS=(auth supabase_migrations)
# auth.schema_migrations e do GoTrue e acompanha a versao dele, nao o backup.
EXCLUDE_DATA=(auth.schema_migrations)

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

# Le o .env.backup sem exigir senha: pasta e retencao. O que ja estiver no
# ambiente ganha do arquivo (BACKUP_KEEP=3 make backup funciona).
load_config() {
  local line key
  if [[ -f "$root/.env.backup" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
      key="${BASH_REMATCH[1]}"
      [[ -n "${!key+set}" ]] && continue
      # eval para aceitar valores entre aspas, como BACKUP_ENVS="prod dev".
      eval "export $key=${BASH_REMATCH[2]}"
    done < "$root/.env.backup"
  fi
  BACKUP_DIR="${BACKUP_DIR:-$root/backups}"
  [[ "$BACKUP_DIR" = /* ]] || BACKUP_DIR="$root/$BACKUP_DIR"
  BACKUP_KEEP="${BACKUP_KEEP:-7}"
  [[ "$BACKUP_KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "BACKUP_KEEP precisa ser um numero >= 1" >&2; exit 2; }
}

check_env() {
  [[ "$1" =~ ^(dev|prod)$ ]] || { echo "ambiente invalido: '$1' (use dev ou prod; homol e staging usam o banco de dev)" >&2; exit 2; }
}

# Exporta DB_URL e PGPASSWORD do projeto. Mesmos nomes das variaveis e secrets
# do GitHub: SUPABASE_REF_<ENV> e SUPABASE_DB_PASSWORD_<ENV>. A conexao e pelo
# pooler em modo sessao (IPv4; o host direto db.<ref>.supabase.co e so IPv6 no
# plano free).
load_env() {
  local env="$1"
  check_env "$env"
  load_config
  local ref_var="SUPABASE_REF_${env^^}" pass_var="SUPABASE_DB_PASSWORD_${env^^}"
  REF="${!ref_var:-}"
  PGPASSWORD="${!pass_var:-}"
  [[ -n "$REF" && -n "$PGPASSWORD" ]] || { echo "defina $ref_var e $pass_var no .env.backup (veja docs/backup.md)" >&2; exit 2; }
  DB_URL="postgresql://postgres.$REF@${BACKUP_POOLER_HOST:-aws-0-sa-east-1.pooler.supabase.com}:5432/postgres?sslmode=require"
  export DB_URL PGPASSWORD
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

# Estado do que o backup cobre, calculado no servidor (volta ~100 bytes):
#   - quando o Postgres subiu: se reiniciou, os contadores abaixo zeram, e na
#     duvida faz backup;
#   - linhas inseridas, alteradas e apagadas nas tabelas do backup;
#   - md5 da estrutura dos schemas da aplicacao (colunas, constraints,
#     policies, funcoes, triggers, grants). relfilenode muda num TRUNCATE.
# O WAL nao serve: o Supabase o rotaciona a cada 2 min mesmo sem escrita.
state_sql() {
  local app plat
  app="$(printf "'%s'," "${APP_SCHEMAS[@]}")"; app="${app%,}"
  plat="$(printf "'%s'," "${PLATFORM_SCHEMAS[@]}")"; plat="${plat%,}"
  cat <<SQL
with nsp as (select oid from pg_namespace where nspname in ($app)),
rel as (select oid from pg_class where relnamespace in (select oid from nsp)),
estrutura as (
  select c.oid::regclass::text || ' ' || c.relkind::text || ' ' || c.relfilenode || ' ' || c.relrowsecurity || ' '
         || coalesce(c.relacl::text, '') || ' '
         || coalesce((select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull
                                        || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attnum)
                      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') as x
  from pg_class c where c.oid in (select oid from rel)
  union all select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
  from pg_constraint where connamespace in (select oid from nsp)
  union all select polrelid::regclass::text || ' ' || polname || ' ' || polcmd::text || ' ' || polroles::text || ' '
         || coalesce(pg_get_expr(polqual, polrelid), '') || ' ' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
  from pg_policy where polrelid in (select oid from rel)
  union all select oid::regprocedure::text || ' ' || md5(prosrc) || ' ' || prosecdef || ' ' || coalesce(proacl::text, '')
         || ' ' || coalesce(array_to_string(proconfig, ','), '')
  from pg_proc where pronamespace in (select oid from nsp)
  union all select tgrelid::regclass::text || ' ' || tgname || ' ' || tgenabled::text
  from pg_trigger where not tgisinternal and tgrelid in (select oid from rel)
  union all select nspname || ' ' || coalesce(nspacl::text, '') from pg_namespace where oid in (select oid from nsp)
)
select pg_postmaster_start_time()::text
  || ' | ' || (select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)
               from pg_stat_user_tables where schemaname in ($app, $plat))
  || ' | ' || (select md5(coalesce(string_agg(x, E'\n' order by x), '')) from estrutura)
SQL
}

# Backups de um ambiente, do mais antigo para o mais recente.
list_backups() { # env
  find "$BACKUP_DIR/$1" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' 2>/dev/null | sort
}

# Escolhe um backup: pasta, "latest" ou o nome/data que aparece em
# `make backups` (20261001T141252Z, 20261001, 2026-10-01). Se varios casam,
# fica o mais recente.
resolve_backup() { # env, referencia
  local env="$1" ref="${2:-latest}" found
  if [[ -d "$ref" ]]; then (cd "$ref" && pwd); return; fi
  [[ "$ref" == latest || "$ref" =~ ^[0-9TZ-]+$ ]] || { echo "backup invalido: '$ref'" >&2; exit 2; }
  [[ "$ref" == latest ]] && ref=""
  found="$(list_backups "$env" | grep -F "/${ref//-/}" | tail -1 || true)"
  [[ -n "$found" ]] || { echo "nenhum backup de $env casa com '${2:-latest}' (veja: make backups ENV=$env)" >&2; exit 2; }
  echo "$found"
}
