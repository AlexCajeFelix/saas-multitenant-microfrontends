#!/usr/bin/env bash
# ===========================================================================
# Drift entre o repositorio e um projeto Supabase.
#
#   scripts/deploy/supabase-drift.sh <project-ref> [--allow-pending]
#
# Tres perguntas, nesta ordem:
#   1. Ha migration aplicada no banco que nao existe no repositorio?
#      -> alguem mexeu por fora (dashboard, psql). Falha sempre.
#   2. Ha migration do repositorio ainda nao aplicada?
#      -> "precisa subir migration nova". No PR e so aviso (--allow-pending);
#         depois do deploy e falha, porque o deploy deveria te-la aplicado.
#   3. O schema real bate com o que as migrations produzem?
#      -> `supabase db diff --linked`. Qualquer diferenca e drift.
#
# Ambiente: SUPABASE_ACCESS_TOKEN (e SUPABASE_DB_PASSWORD, se quiser evitar o
# papel temporario que o CLI cria pela Management API). Precisa de Docker.
# ===========================================================================
set -euo pipefail

ref="${1:?project ref}"
allow_pending="${2:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

: "${SUPABASE_ACCESS_TOKEN:?defina SUPABASE_ACCESS_TOKEN}"
supabase() { pnpm exec supabase "$@"; }
summary() { [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }

echo "==> vinculando ao projeto $ref"
supabase link --project-ref "$ref" ${SUPABASE_DB_PASSWORD:+--password "$SUPABASE_DB_PASSWORD"} >/dev/null

echo "==> historico de migrations (local x remoto)"
listing="$(supabase migration list --linked 2>/dev/null)"
echo "$listing"

# Linhas da tabela: " local | remoto | hora "
remote_only=()
pending=()
while IFS='|' read -r local remote _; do
  local="$(echo "$local" | xargs)"; remote="$(echo "$remote" | xargs)"
  [[ "$local" =~ ^[0-9]+$ || "$remote" =~ ^[0-9]+$ ]] || continue
  if [[ -z "$local" && -n "$remote" ]]; then remote_only+=("$remote"); fi
  if [[ -n "$local" && -z "$remote" ]]; then pending+=("$local"); fi
done <<< "$listing"

status=0
summary "### Drift do banco ($ref)"

if (( ${#remote_only[@]} > 0 )); then
  echo "::error::Migrations aplicadas no banco e ausentes do repositorio: ${remote_only[*]}"
  summary "- :x: aplicadas no banco e ausentes do repo: \`${remote_only[*]}\`"
  status=1
fi

if (( ${#pending[@]} > 0 )); then
  if [[ "$allow_pending" == "--allow-pending" ]]; then
    echo "::notice::Migrations novas que este merge vai subir: ${pending[*]}"
    summary "- :arrow_up: migrations novas que o deploy vai aplicar: \`${pending[*]}\`"
  else
    echo "::error::Migrations do repositorio ainda nao aplicadas: ${pending[*]}"
    summary "- :x: migrations do repo ainda nao aplicadas: \`${pending[*]}\`"
    status=1
  fi
else
  summary "- :white_check_mark: historico de migrations em dia"
fi

# Com migration pendente o diff mostraria justamente o que ela vai criar; o
# diff so faz sentido comparando historicos iguais.
if (( ${#pending[@]} == 0 && ${#remote_only[@]} == 0 )); then
  echo "==> comparando o schema real com o das migrations"
  diff_out="$(supabase db diff --linked --schema public,core,iam,crm,projects,billing 2>/dev/null || true)"
  if [[ -n "$(echo "$diff_out" | grep -vE '^\s*(--.*)?$' || true)" ]]; then
    echo "::error::Schema do banco diverge das migrations (drift)"
    echo "$diff_out"
    summary "- :x: schema diverge das migrations:"
    summary '```sql'
    summary "$diff_out"
    summary '```'
    status=1
  else
    summary "- :white_check_mark: schema identico ao das migrations"
  fi
fi

exit "$status"
