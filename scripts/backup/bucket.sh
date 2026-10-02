#!/usr/bin/env bash
# ===========================================================================
# Copia dos backups num bucket privado do Storage do proprio projeto Supabase.
#
#   scripts/backup/bucket.sh backup <dev|prod>           backup e upload (o passo do deploy)
#   scripts/backup/bucket.sh push   <dev|prod> [backup]  sobe um backup local (padrao: latest)
#   scripts/backup/bucket.sh pull   <dev|prod> [backup]  baixa do bucket para backups/<env>/
#   scripts/backup/bucket.sh list   <dev|prod>           lista o que esta no bucket
#   (ou: make bucket-push / bucket-pull / bucket-list ENV=dev FROM=...)
#
# No bucket "backups" (BACKUP_BUCKET), cada backup e a mesma pasta que o
# db-backup.sh gera: <env>/<data UTC>/{db.dump,counts.tsv,state,SHA256SUMS}.
# Ficam os BACKUP_KEEP (7) mais recentes, e o mais antigo so sai depois que o
# novo subiu inteiro. O pull confere o SHA256 antes de entregar a pasta, que
# vai direto para o `make restore`.
#
# `backup` e o passo do deploy de dev: baixa o ultimo backup do bucket (prova
# que ele le e confere), roda db-backup.sh --if-changed contra ele e sobe o
# novo. Se o banco nao mudou, nao faz dump nem sobe nada.
#
# Credencial do Storage, nesta ordem:
#   SUPABASE_SECRET_KEY_<ENV>  chave secreta (sb_secret_...) do projeto
#   SUPABASE_ACCESS_TOKEN      token pessoal (sbp_...): a chave secreta sai da
#                              Management API na hora (o caminho do pipeline)
# A chave chega ao curl por um arquivo de headers, nunca pela linha de comando
# (nao aparece no `ps`). Veja docs/backup.md.
# ===========================================================================
set -euo pipefail

cmd="${1:-}"
env="${2:-}"
[[ "$cmd" =~ ^(backup|push|pull|list)$ && -n "$env" ]] || {
  echo "uso: bucket.sh backup|push|pull|list <dev|prod> [backup]" >&2
  exit 2
}
# shellcheck source=scripts/backup/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
check_env "$env"
load_config
command -v jq > /dev/null || { echo "precisa do jq (apt install jq)" >&2; exit 2; }

ref_var="SUPABASE_REF_${env^^}"
REF="${!ref_var:-}"
[[ -n "$REF" ]] || { echo "defina $ref_var no .env.backup (veja docs/backup.md)" >&2; exit 2; }
BUCKET="${BACKUP_BUCKET:-backups}"
STORAGE="https://$REF.supabase.co/storage/v1"
base="$BACKUP_DIR/$env"

summary() { [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }

# Headers de autenticacao das chamadas, um por linha.
AUTH=""

# metodo, url, [args do curl]: corpo da resposta em stdout; falha com o status
# e a mensagem do servidor se nao for 2xx.
http() {
  local method="$1" url="$2" out code
  shift 2
  out="$(mktemp)"
  code="$(curl -sS --retry 3 -o "$out" -w '%{http_code}' -X "$method" \
    -H @<(printf '%s\n' "$AUTH") "$url" "$@")" || code=000
  if [[ "$code" != 2* ]]; then
    echo "$method ${url#https://} -> HTTP $code $(head -c 300 "$out")" >&2
    rm -f "$out"
    return 1
  fi
  cat "$out"
  rm -f "$out"
}

storage_auth() {
  local var="SUPABASE_SECRET_KEY_${env^^}" key keys
  key="${!var:-}"
  if [[ -z "$key" ]]; then
    [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]] || {
      echo "defina $var ou SUPABASE_ACCESS_TOKEN no .env.backup (veja docs/backup.md)" >&2
      exit 2
    }
    AUTH="Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
    keys="$(http GET "https://api.supabase.com/v1/projects/$REF/api-keys?reveal=true")" || {
      echo "a Management API recusou o SUPABASE_ACCESS_TOKEN. Gere outro em" \
        "https://supabase.com/dashboard/account/tokens e atualize o secret do GitHub" >&2
      exit 1
    }
    # A chave secreta nova; a service_role (legado) so se o projeto nao tiver.
    key="$(jq -r '[.[] | select(.disabled != true) | select(.type == "secret" or .name == "service_role")]
                  | sort_by(.type != "secret") | first | .api_key // empty' <<< "$keys")"
    [[ -n "$key" ]] || { echo "o projeto $REF nao tem chave secreta ativa (Settings > API Keys)" >&2; exit 1; }
  fi
  [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::add-mask::$key"
  AUTH="$(printf 'apikey: %s\nAuthorization: Bearer %s' "$key" "$key")"
}

ensure_bucket() {
  http GET "$STORAGE/bucket/$BUCKET" > /dev/null 2>&1 && return
  echo "==> criando o bucket privado $BUCKET"
  http POST "$STORAGE/bucket" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":false}" > /dev/null
}

# O list devolve pastas (id nulo) e arquivos de um nivel so.
list_prefix() { # prefixo
  http POST "$STORAGE/object/list/$BUCKET" -H 'Content-Type: application/json' \
    -d "{\"prefix\":\"$1\",\"limit\":1000,\"sortBy\":{\"column\":\"name\",\"order\":\"asc\"}}"
}

# Backups do ambiente no bucket, do mais antigo para o mais recente.
remote_backups() {
  local json
  json="$(list_prefix "$env/")"
  jq -r '.[] | select(.id == null) | .name | select(test("^20[0-9]{6}T[0-9]{6}Z$"))' <<< "$json" | sort
}

# Arquivos de um backup no bucket: nome<TAB>bytes.
remote_files() { # backup
  local json
  json="$(list_prefix "$env/$1/")"
  jq -r '.[] | select(.id != null) | "\(.name)\t\(.metadata.size // 0)"' <<< "$json"
}

delete_objects() { # caminhos no bucket
  http DELETE "$STORAGE/object/$BUCKET" -H 'Content-Type: application/json' \
    -d "$(jq -cn '{prefixes: $ARGS.positional}' --args "$@")" > /dev/null
}

# Escolhe um backup do bucket: latest ou nome/data, como no resolve_backup.
resolve_remote() { # referencia
  local ref="${1:-latest}" all found
  [[ "$ref" == latest || "$ref" =~ ^[0-9TZ-]+$ ]] || { echo "backup invalido: '$ref'" >&2; exit 2; }
  [[ "$ref" == latest ]] && ref=""
  all="$(remote_backups)"
  found="$(grep "^${ref//-/}" <<< "$all" | tail -1 || true)"
  [[ -n "$found" ]] || { echo "nenhum backup de $env no bucket casa com '${1:-latest}' (veja: make bucket-list ENV=$env)" >&2; exit 2; }
  echo "$found"
}

pull() { # backup
  local name="$1" dest="$base/$1" tmp files file
  if [[ -f "$dest/SHA256SUMS" ]] && (cd "$dest" && sha256sum --quiet -c SHA256SUMS > /dev/null 2>&1); then
    echo "==> $env/$name do bucket ja esta em ${dest#"$root"/}"
    return
  fi
  mkdir -p "$base"
  chmod 700 "$BACKUP_DIR" "$base"
  # Baixa ao lado e so troca no fim: pasta pela metade nao parece backup.
  tmp="$base/.pull-$name"
  rm -rf "$tmp"
  mkdir -m 700 "$tmp"
  echo "==> baixando $BUCKET/$env/$name"
  files="$(remote_files "$name")"
  [[ -n "$files" ]] || { echo "o backup $name esta vazio no bucket" >&2; rm -rf "$tmp"; exit 1; }
  while IFS=$'\t' read -r file _; do
    [[ "$file" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "arquivo inesperado no bucket: '$file'" >&2; rm -rf "$tmp"; exit 1; }
    http GET "$STORAGE/object/authenticated/$BUCKET/$env/$name/$file" > "$tmp/$file" || { rm -rf "$tmp"; exit 1; }
  done <<< "$files"
  if ! (cd "$tmp" && sha256sum --quiet -c SHA256SUMS); then
    rm -rf "$tmp"
    echo "o backup $name do bucket nao confere com o SHA256SUMS dele" >&2
    exit 1
  fi
  chmod 600 "$tmp"/*
  rm -rf "$dest"
  mv "$tmp" "$dest"
  echo "    $(du -sh "$dest" | cut -f1), conferido (SHA256): ${dest#"$root"/}"
}

push() { # pasta local
  local dir="$1" name file uploaded=()
  name="$(basename "$dir")"
  (cd "$dir" && sha256sum --quiet -c SHA256SUMS) || { echo "${dir#"$root"/} nao confere com o SHA256SUMS; nao subo" >&2; exit 1; }
  if grep -qx "$name" <<< "$(remote_backups)"; then
    echo "==> $env/$name ja esta no bucket"
    return
  fi
  echo "==> subindo ${dir#"$root"/} para o bucket $BUCKET"
  # SHA256SUMS por ultimo: uma pasta sem ele o pull recusa.
  for file in $(awk '{ print $2 }' "$dir/SHA256SUMS") SHA256SUMS; do
    if ! http POST "$STORAGE/object/$BUCKET/$env/$name/$file" -H 'Content-Type: application/octet-stream' \
      -H 'x-upsert: false' --data-binary "@$dir/$file" > /dev/null; then
      echo "upload falhou; removendo $env/$name do bucket" >&2
      (( ${#uploaded[@]} == 0 )) || delete_objects "${uploaded[@]}" || true
      exit 1
    fi
    uploaded+=("$env/$name/$file")
  done
  echo "    $(du -sh "$dir" | cut -f1) enviados"
}

# Retencao igual a local: os BACKUP_KEEP mais recentes. Depois do push.
prune() {
  local names all name files paths
  names="$(remote_backups)"
  mapfile -t all < <(grep . <<< "$names" || true)
  (( ${#all[@]} > BACKUP_KEEP )) || return 0
  echo "==> bucket: mantendo os $BACKUP_KEEP mais recentes"
  for name in "${all[@]:0:${#all[@]}-BACKUP_KEEP}"; do
    echo "    apagando $env/$name"
    files="$(remote_files "$name")"
    mapfile -t paths < <(cut -f1 <<< "$files" | grep . | sed "s|^|$env/$name/|")
    (( ${#paths[@]} == 0 )) || delete_objects "${paths[@]}"
  done
}

# Uma linha por backup no bucket: nome<TAB>bytes.
remote_sizes() {
  local all name files
  all="$(remote_backups)"
  for name in $all; do
    files="$(remote_files "$name")"
    printf '%s\t%s\n' "$name" "$(awk -F'\t' '{ s += $2 } END { print s + 0 }' <<< "$files")"
  done
}

human() { numfmt --to=iec "$1"; }

# Lista o bucket e deixa em COUNT e TOTAL (bytes) o resumo, para o summary.
list() {
  local sizes latest name bytes iso
  sizes="$(remote_sizes)"
  TOTAL="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' <<< "$sizes")"
  COUNT="$(grep -c . <<< "$sizes" || true)"
  echo "$env no bucket $BUCKET ($REF): $COUNT backup(s), $(human "$TOTAL"), guardando os $BACKUP_KEEP mais recentes"
  (( COUNT > 0 )) || return 0
  latest="$(tail -1 <<< "$sizes" | cut -f1)"
  printf '  %-18s %-17s %8s\n' backup "hora local" tamanho
  tac <<< "$sizes" | while IFS=$'\t' read -r name bytes; do
    iso="${name:0:4}-${name:4:2}-${name:6:2}T${name:9:2}:${name:11:2}:${name:13:2}Z"
    printf '  %-18s %-17s %8s%s\n' "$name" "$(date -d "$iso" '+%d/%m/%Y %H:%M')" "$(human "$bytes")" \
      "$([[ "$name" == "$latest" ]] && echo '  <- latest')"
  done
}

storage_auth
case "$cmd" in
  list)
    list
    ;;
  pull)
    name="$(resolve_remote "${3:-latest}")"
    pull "$name"
    ;;
  push)
    dir="$(resolve_backup "$env" "${3:-latest}")"
    ensure_bucket
    push "$dir"
    prune
    list
    ;;
  backup)
    ensure_bucket
    last="$(remote_backups | tail -1)"
    if [[ -n "$last" ]]; then pull "$last"; fi
    "$root/scripts/backup/db-backup.sh" "$env" --if-changed
    newest="$(list_backups "$env" | tail -1)"
    push "$newest"
    prune
    list
    name="$(basename "$newest")"
    summary "### Backup de $env no bucket \`$BUCKET\`"
    if [[ "$name" == "$last" ]]; then
      summary "- banco igual ao do ultimo backup (\`$name\`): nada novo"
    else
      summary "- novo backup \`$name\`: $(wc -l < "$newest/counts.tsv") tabelas," \
        "$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$newest/counts.tsv") linhas, $(du -sh "$newest" | cut -f1)"
    fi
    summary "- no bucket: $COUNT backup(s), $(human "$TOTAL") (cota do free: 1 GB de Storage na organizacao)"
    ;;
esac
