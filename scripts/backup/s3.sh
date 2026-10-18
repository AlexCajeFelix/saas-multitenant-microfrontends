#!/usr/bin/env bash
# ===========================================================================
# Copia dos backups num bucket do Amazon S3, com fila dos S3_KEEP (30) mais
# recentes: entra um por dia, sai o mais antigo.
#
#   scripts/backup/s3.sh backup <dev|prod>           dump e upload (o job diario)
#   scripts/backup/s3.sh push   <dev|prod> [backup]  sobe um backup local (padrao: latest)
#   scripts/backup/s3.sh pull   <dev|prod> [backup]  baixa do S3 para backups/<env>/
#   scripts/backup/s3.sh list   <dev|prod>           lista o que esta no S3
#   (ou: make s3-push / s3-pull / s3-list ENV=dev FROM=...)
#
# Cada backup e a mesma pasta que o db-backup.sh gera, um objeto por arquivo:
#   s3://<S3_BUCKET>/<S3_PREFIX>/<env>/<data UTC>/{db.dump,counts.tsv,state,SHA256SUMS}
# O SHA256SUMS sobe por ultimo e o pull confere tudo com ele antes de entregar
# a pasta, que vai direto para o `make restore`.
#
# A fila e por quantidade, nao por idade: se o job parar por um mes, os 30
# ultimos continuam la (uma regra de expiracao por dias apagaria todos). O
# mais antigo so sai depois que o novo subiu inteiro. Com o versionamento do
# bucket, o apagado vira versao antiga e a regra de ciclo de vida do bucket o
# remove de vez dias depois.
#
# Configuracao (ambiente ou .env.backup): S3_BUCKET, S3_PREFIX
# (onde-fica-o-backup), S3_KEEP (30), AWS_REGION (us-east-2) e a credencial
# da AWS de sempre: AWS_PROFILE na maquina, AWS_ACCESS_KEY_ID e
# AWS_SECRET_ACCESS_KEY no GitHub. Veja docs/backup.md.
# ===========================================================================
set -euo pipefail

cmd="${1:-}"
env="${2:-}"
[[ "$cmd" =~ ^(backup|push|pull|list)$ && -n "$env" ]] || {
  echo "uso: s3.sh backup|push|pull|list <dev|prod> [backup]" >&2
  exit 2
}
# shellcheck source=scripts/backup/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
check_env "$env"
load_config
command -v aws > /dev/null || { echo "precisa da AWS CLI (https://aws.amazon.com/cli/)" >&2; exit 2; }

[[ -n "${S3_BUCKET:-}" ]] || { echo "defina S3_BUCKET no .env.backup (veja docs/backup.md)" >&2; exit 2; }
S3_PREFIX="${S3_PREFIX:-onde-fica-o-backup}"
S3_PREFIX="${S3_PREFIX%/}"
S3_KEEP="${S3_KEEP:-30}"
[[ "$S3_KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "S3_KEEP precisa ser um numero >= 1" >&2; exit 2; }
export AWS_REGION="${AWS_REGION:-us-east-2}"
base="$BACKUP_DIR/$env"
remote="$S3_PREFIX/$env"

summary() { if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$*" >> "$GITHUB_STEP_SUMMARY"; fi; }

# Objetos do ambiente no bucket: chave<TAB>bytes.
remote_objects() {
  aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$remote/" \
    --query 'Contents[].[Key, Size]' --output text | grep -v '^None$' || true
}

# Backups do ambiente no bucket, do mais antigo para o mais recente.
remote_backups() {
  remote_objects | cut -f1 | sed -nE "s|^$remote/(20[0-9]{6}T[0-9]{6}Z)/.*|\1|p" | sort -u
}

# Escolhe um backup do bucket: latest ou nome/data, como no resolve_backup.
resolve_remote() { # referencia
  local ref="${1:-latest}" found
  [[ "$ref" == latest || "$ref" =~ ^[0-9TZ-]+$ ]] || { echo "backup invalido: '$ref'" >&2; exit 2; }
  [[ "$ref" == latest ]] && ref=""
  found="$(remote_backups | grep "^${ref//-/}" | tail -1 || true)"
  [[ -n "$found" ]] || { echo "nenhum backup de $env no S3 casa com '${1:-latest}' (veja: make s3-list ENV=$env)" >&2; exit 2; }
  echo "$found"
}

pull() { # backup
  local name="$1" dest="$base/$1" tmp
  if [[ -f "$dest/SHA256SUMS" ]] && (cd "$dest" && sha256sum --quiet -c SHA256SUMS > /dev/null 2>&1); then
    echo "==> $env/$name do S3 ja esta em ${dest#"$root"/}"
    return
  fi
  mkdir -p "$base"
  chmod 700 "$BACKUP_DIR" "$base"
  # Baixa ao lado e so troca no fim: pasta pela metade nao parece backup.
  tmp="$base/.pull-$name"
  rm -rf "$tmp"
  mkdir -m 700 "$tmp"
  echo "==> baixando s3://$S3_BUCKET/$remote/$name"
  aws s3 cp --recursive --only-show-errors "s3://$S3_BUCKET/$remote/$name/" "$tmp/" || { rm -rf "$tmp"; exit 1; }
  if [[ ! -f "$tmp/SHA256SUMS" ]] || ! (cd "$tmp" && sha256sum --quiet -c SHA256SUMS); then
    rm -rf "$tmp"
    echo "o backup $name do S3 esta incompleto ou nao confere com o SHA256SUMS dele" >&2
    exit 1
  fi
  chmod 600 "$tmp"/*
  rm -rf "$dest"
  mv "$tmp" "$dest"
  echo "    $(du -sh "$dest" | cut -f1), conferido (SHA256): ${dest#"$root"/}"
}

push() { # pasta local
  local dir="$1" name file
  name="$(basename "$dir")"
  (cd "$dir" && sha256sum --quiet -c SHA256SUMS) || { echo "${dir#"$root"/} nao confere com o SHA256SUMS; nao subo" >&2; exit 1; }
  if grep -qx "$name" <<< "$(remote_backups)"; then
    echo "==> $env/$name ja esta no S3"
    return
  fi
  echo "==> subindo ${dir#"$root"/} para s3://$S3_BUCKET/$remote/"
  # SHA256SUMS por ultimo: uma pasta sem ele o pull recusa.
  for file in $(awk '{ print $2 }' "$dir/SHA256SUMS") SHA256SUMS; do
    if ! aws s3 cp --only-show-errors "$dir/$file" "s3://$S3_BUCKET/$remote/$name/$file"; then
      echo "upload falhou; removendo $env/$name do S3" >&2
      aws s3 rm --recursive --only-show-errors "s3://$S3_BUCKET/$remote/$name/" || true
      exit 1
    fi
  done
  echo "    $(du -sh "$dir" | cut -f1) enviados"
}

# A fila: os S3_KEEP mais recentes. Sempre depois do push.
prune() {
  local all name
  mapfile -t all < <(remote_backups)
  (( ${#all[@]} > S3_KEEP )) || return 0
  echo "==> S3: mantendo os $S3_KEEP mais recentes"
  for name in "${all[@]:0:${#all[@]}-S3_KEEP}"; do
    echo "    saindo da fila: $env/$name"
    aws s3 rm --recursive --only-show-errors "s3://$S3_BUCKET/$remote/$name/"
  done
}

human() { numfmt --to=iec "$1"; }

# Lista o bucket e deixa em COUNT e TOTAL (bytes) o resumo, para o summary.
list() {
  local sizes latest name bytes iso
  sizes="$(remote_objects | awk -F'\t' -v p="$remote/" '
    index($1, p) == 1 {
      n = substr($1, length(p) + 1); sub(/\/.*/, "", n)
      if (n ~ /^20[0-9]+T[0-9]+Z$/) s[n] += $2
    }
    END { for (n in s) print n "\t" s[n] }' | sort)"
  TOTAL="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' <<< "$sizes")"
  COUNT="$(grep -c . <<< "$sizes" || true)"
  echo "$env em s3://$S3_BUCKET/$remote/: $COUNT de $S3_KEEP backup(s) na fila, $(human "$TOTAL")"
  (( COUNT > 0 )) || return 0
  latest="$(tail -1 <<< "$sizes" | cut -f1)"
  printf '  %-18s %-17s %8s\n' backup "hora local" tamanho
  tac <<< "$sizes" | while IFS=$'\t' read -r name bytes; do
    iso="${name:0:4}-${name:4:2}-${name:6:2}T${name:9:2}:${name:11:2}:${name:13:2}Z"
    printf '  %-18s %-17s %8s%s\n' "$name" "$(date -d "$iso" '+%d/%m/%Y %H:%M')" "$(human "$bytes")" \
      "$([[ "$name" == "$latest" ]] && echo '  <- latest')"
  done
}

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
    push "$dir"
    prune
    list
    ;;
  backup)
    # Um por dia, mesmo sem mudanca: a fila e de dias, e 30 itens sao 30 dias.
    "$root/scripts/backup/db-backup.sh" "$env"
    newest="$(list_backups "$env" | tail -1)"
    push "$newest"
    prune
    list
    summary "### Backup de $env no S3 (\`s3://$S3_BUCKET/$remote/\`)"
    summary "- novo backup \`$(basename "$newest")\`: $(wc -l < "$newest/counts.tsv") tabelas," \
      "$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$newest/counts.tsv") linhas, $(du -sh "$newest" | cut -f1)"
    summary "- na fila: $COUNT de $S3_KEEP, $(human "$TOTAL")"
    ;;
esac
