#!/usr/bin/env bash
# ===========================================================================
# Configura o repositorio no GitHub: environments, variaveis e rulesets.
# Idempotente: pode rodar de novo depois de mudar algo aqui.
#
#   scripts/setup/github.sh <owner/repo>
#
# Variaveis de entrada (as que faltarem sao puladas com aviso):
#   SUPABASE_REF_DEV, SUPABASE_URL_DEV, SUPABASE_ANON_KEY_DEV
#   SUPABASE_REF_PROD, SUPABASE_URL_PROD, SUPABASE_ANON_KEY_PROD
#   VERCEL_SCOPE, VERCEL_ALIAS_PREFIX
#   SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN           (viram secrets do repo)
#   PROD_REVIEWER                                 (login que aprova deploy em prod)
#
# Rulesets e protecao de environment sao gratuitos em repositorio PUBLICO. Em
# repositorio privado exigem GitHub Pro/Team; o script avisa se falharem.
# ===========================================================================
set -euo pipefail

repo="${1:?owner/repo}"
api() { gh api -H "Accept: application/vnd.github+json" "$@"; }

set_var() { # nome valor [ambiente]
  local name="$1" value="$2" env="${3:-}"
  if [[ -z "$value" ]]; then echo "  - $name vazio, pulando"; return; fi
  if [[ -n "$env" ]]; then
    gh variable set "$name" --repo "$repo" --env "$env" --body "$value" >/dev/null
  else
    gh variable set "$name" --repo "$repo" --body "$value" >/dev/null
  fi
  echo "  - var $name${env:+ ($env)}"
}

set_secret() { # nome valor
  if [[ -z "$2" ]]; then echo "  - secret $1 vazio, pulando"; return; fi
  gh secret set "$1" --repo "$repo" --body "$2" >/dev/null
  echo "  - secret $1"
}

echo "==> variaveis e segredos do repositorio"
set_var SUPABASE_REF_DEV "${SUPABASE_REF_DEV:-}"
set_var SUPABASE_REF_PROD "${SUPABASE_REF_PROD:-}"
set_var VERCEL_SCOPE "${VERCEL_SCOPE:-}"
set_var VERCEL_ALIAS_PREFIX "${VERCEL_ALIAS_PREFIX:-}"
set_secret SUPABASE_ACCESS_TOKEN "${SUPABASE_ACCESS_TOKEN:-}"
set_secret VERCEL_TOKEN "${VERCEL_TOKEN:-}"

# ambiente | branch que publica nele | projeto Supabase | demo users
envs=(
  "dev|develop|DEV|true"
  "homol|homol|DEV|true"
  "staging|staging|DEV|true"
  "prod|main|PROD|false"
)

for row in "${envs[@]}"; do
  IFS='|' read -r env branch target demo <<< "$row"
  echo "==> environment $env (branch $branch, Supabase $target)"

  reviewers='[]'
  if [[ "$env" == "prod" && -n "${PROD_REVIEWER:-}" ]]; then
    id="$(api "users/$PROD_REVIEWER" --jq .id)"
    reviewers="[{\"type\":\"User\",\"id\":$id}]"
  fi
  if ! api -X PUT "repos/$repo/environments/$env" --input - >/dev/null <<EOF
{
  "reviewers": $reviewers,
  "prevent_self_review": false,
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
EOF
  then
    echo "  ! protecao do environment recusada (repo privado sem plano pago?); criando sem protecao"
    api -X PUT "repos/$repo/environments/$env" >/dev/null
  fi

  # So a branch do ambiente publica nele (workflow_dispatch tambem respeita).
  existing="$(api "repos/$repo/environments/$env/deployment-branch-policies" --jq '.branch_policies[].name' 2>/dev/null || true)"
  if ! grep -qx "$branch" <<< "$existing"; then
    api -X POST "repos/$repo/environments/$env/deployment-branch-policies" \
      -f name="$branch" -f type=branch >/dev/null 2>&1 || true
  fi

  ref_var="SUPABASE_REF_$target"; url_var="SUPABASE_URL_$target"; key_var="SUPABASE_ANON_KEY_$target"
  set_var SUPABASE_PROJECT_REF "${!ref_var:-}" "$env"
  set_var SUPABASE_URL "${!url_var:-}" "$env"
  set_var SUPABASE_ANON_KEY "${!key_var:-}" "$env"
  set_var SHOW_DEMO_USERS "$demo" "$env"
done

echo "==> rulesets"
upsert_ruleset() { # nome json
  local name="$1" body="$2" id
  id="$(api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id" 2>/dev/null || true)"
  if [[ -n "$id" ]]; then
    api -X PUT "repos/$repo/rulesets/$id" --input - >/dev/null <<< "$body"
  else
    api -X POST "repos/$repo/rulesets" --input - >/dev/null <<< "$body"
  fi && echo "  - $name" || echo "  ! $name recusado (repo privado sem plano pago?)"
}

checks='[
  {"context":"promotion"},{"context":"quality"},{"context":"edge-functions"},
  {"context":"migrations"},{"context":"drift"},{"context":"secrets"}
]'

# Branches de ambiente: so por PR, com CI verde, sem force push nem delete.
upsert_ruleset "ambientes" "$(cat <<EOF
{
  "name": "ambientes",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": {
    "include": ["refs/heads/develop","refs/heads/homol","refs/heads/staging","refs/heads/main"],
    "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["merge", "squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": $checks } }
  ],
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" } ]
}
EOF
)"

# Producao: alem do anterior, exige 1 aprovacao no PR para main. Promocao entre
# ambientes e por merge commit (squash reescreveria o historico e a proxima
# promocao staging -> main viria com conflitos falsos). O admin do repo pode
# aprovar por bypass, para quem trabalha sozinho.
upsert_ruleset "producao" "$(cat <<'EOF'
{
  "name": "producao",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["merge"] } }
  ],
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" } ]
}
EOF
)"

# Tags de versao imutaveis.
upsert_ruleset "tags" "$(cat <<'EOF'
{
  "name": "tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" } ]
}
EOF
)"

echo "==> pronto"
