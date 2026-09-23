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
listing="$(supabase migration list --linked --output-format json 2>/dev/null)"

# {"migrations":[{"local":"0001","remote":"0001"}, ...]}: uma versao so de um
# lado e o que interessa. Sai uma linha "remote_only|pending" por versao.
parsed="$(node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const rows = JSON.parse(s.slice(s.indexOf("{"))).migrations ?? [];
    for (const { local, remote } of rows) {
      if (!local && remote) console.log(`remote_only ${remote}`);
      if (local && !remote) console.log(`pending ${local}`);
    }
    console.error(`    ${rows.length} versoes no historico`);
  });' <<< "$listing")"

remote_only=()
pending=()
while read -r kind version; do
  [[ "$kind" == remote_only ]] && remote_only+=("$version")
  [[ "$kind" == pending ]] && pending+=("$version")
done <<< "$parsed"

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
  # `-f` so grava arquivo quando ha diferenca: nao depende do formato da saida.
  before="$(ls supabase/migrations)"
  diff_log="$(mktemp)"
  if ! supabase db diff --linked --schema public,core,iam,crm,projects,billing -f drift_check >"$diff_log" 2>&1; then
    # Falha de execucao (conexao, Docker...) nao e drift: diz o que houve.
    reason="$(grep -iE 'error|failed|fatal' "$diff_log" | tail -3)"
    echo "::error::Nao consegui comparar o schema (isto NAO e drift): ${reason:-veja o log acima}"
    tail -20 "$diff_log"
    summary "- :warning: nao consegui comparar o schema (erro de execucao, nao drift):"
    summary '```'
    summary "${reason:-sem detalhe}"
    summary '```'
    [[ -z "${SUPABASE_DB_PASSWORD:-}" ]] &&
      summary "  Dica: defina SUPABASE_DB_PASSWORD; o login temporario do CLI pode expirar durante o diff."
    exit 1
  fi
  drift_file="$(comm -13 <(echo "$before") <(ls supabase/migrations) | head -1)"
  if [[ -n "$drift_file" ]]; then
    diff_out="$(cat "supabase/migrations/$drift_file")"
    rm -f "supabase/migrations/$drift_file"
    echo "::error::DRIFT: o banco tem mudancas que nao estao nas migrations. SQL que falta no repositorio (esta no resumo do job):"
    echo "$diff_out"
    echo "Para corrigir: crie uma migration com esse SQL (supabase migration new <nome>) ou desfaca a mudanca no banco."
    summary "- :x: **drift**: o banco tem mudancas fora das migrations. SQL que falta no repositorio:"
    summary '```sql'
    summary "$diff_out"
    summary '```'
    summary "  Corrija criando uma migration com esse SQL ou desfazendo a mudanca no banco."
    status=1
  else
    summary "- :white_check_mark: schema identico ao das migrations"
  fi
fi

exit "$status"
