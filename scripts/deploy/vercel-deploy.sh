#!/usr/bin/env bash
# ===========================================================================
# Publica uma zona ja buildada na Vercel e aponta o alias estavel do ambiente.
#
#   scripts/deploy/vercel-deploy.sh <zona> <ambiente>
#
# Espera o build em apps/<zona>/dist. Cria o projeto na Vercel se ainda nao
# existir (<VERCEL_PROJECT_PREFIX>-<zona>), desliga a Deployment Protection
# (o shell busca a zona por rewrite, sem cookie de login da Vercel) e publica
# o diretorio como site estatico, sem build do lado da Vercel.
#
# Ambiente: VERCEL_TOKEN, VERCEL_ALIAS_PREFIX; opcionais VERCEL_SCOPE (time) e
# VERCEL_PROJECT_PREFIX.
# Saida: url=<deploy> e host=<alias> em $GITHUB_OUTPUT, quando existir.
# ===========================================================================
set -euo pipefail

zone="${1:?zona}"
env="${2:?ambiente}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dist="$root/apps/$zone/dist"

: "${VERCEL_TOKEN:?defina VERCEL_TOKEN}"
: "${VERCEL_ALIAS_PREFIX:?defina VERCEL_ALIAS_PREFIX}"
project="${VERCEL_PROJECT_PREFIX:-$VERCEL_ALIAS_PREFIX}-$zone"

# Sem VERCEL_SCOPE, vale a conta pessoal dona do token.
scope=()
[[ -n "${VERCEL_SCOPE:-}" ]] && scope=(--scope "$VERCEL_SCOPE")
vercel() { (cd "$root" && pnpm exec vercel --token "$VERCEL_TOKEN" "${scope[@]}" "$@"); }

if [[ ! -f "$dist/index.html" && ! -f "$dist/_zones/$zone/index.html" ]]; then
  echo "Build de $zone nao encontrado em $dist. Rode o build antes." >&2
  exit 1
fi

node "$root/scripts/deploy/vercel-config.mjs" "$zone" "$env" > "$dist/vercel.json"

echo "==> vinculando $dist ao projeto $project"
vercel link --yes --project "$project" --cwd "$dist" >/dev/null

project_id="$(node -p "require('$dist/.vercel/project.json').projectId")"
org_id="$(node -p "require('$dist/.vercel/project.json').orgId")"
team_query=""
[[ "$org_id" == team_* ]] && team_query="?teamId=$org_id"

# Site estatico, sem build na Vercel, e sem Deployment Protection: o conteudo e
# o mesmo bundle publico que o navegador baixa; os dados ficam atras do login
# do Supabase e da RLS, nao do SSO da Vercel.
curl -fsS -X PATCH "https://api.vercel.com/v9/projects/$project_id$team_query" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"framework":null,"buildCommand":"","installCommand":"","outputDirectory":null,"ssoProtection":null}' \
  >/dev/null

# O `vercel link` conecta o projeto ao repositorio Git quando acha um remote, e
# a Vercel passaria a buildar sozinha a cada push, fora da ordem do Recreate.
# Quem publica e so este pipeline, entao desconectamos.
curl -sS -X DELETE "https://api.vercel.com/v9/projects/$project_id/link$team_query" \
  -H "Authorization: Bearer $VERCEL_TOKEN" >/dev/null || true

prod_flag=()
[[ "$env" == "prod" ]] && prod_flag=(--prod)

echo "==> publicando $zone ($env)"
url="$(vercel deploy "$dist" --yes --format json "${prod_flag[@]}" \
  --meta "sha=${GITHUB_SHA:-local}" --meta "env=$env" --meta "zone=$zone" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(r.deployment?.readyState!=="READY"){console.error(s);process.exit(1)}process.stdout.write(r.deployment.url)})')"

host="$(node "$root/scripts/deploy/hosts.mjs" "$zone" "$env")"
echo "==> alias $host -> $url"
vercel alias set "$url" "$host" >/dev/null

echo "    $zone: https://$host ($url)"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "url=$url" >> "$GITHUB_OUTPUT"
  echo "host=$host" >> "$GITHUB_OUTPUT"
fi
