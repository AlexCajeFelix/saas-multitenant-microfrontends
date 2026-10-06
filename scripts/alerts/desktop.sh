#!/usr/bin/env bash
# ===========================================================================
# Leva os alertas do ntfy local para a notificacao do desktop (notify-send).
# Roda como servico do usuario (saas-alertas-desktop), que o make alerts-up
# instala e o make alerts-down remove.
#
# Critico fica na tela ate ser dispensado; aviso e resolvido somem sozinhos.
# Guarda o id da ultima mensagem mostrada: o que chegou com o servico parado
# (maquina dormindo, sessao fechada) aparece quando ele volta.
# ===========================================================================
set -uo pipefail

# shellcheck source=scripts/alerts/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
state="${XDG_STATE_HOME:-$HOME/.local/state}/saas-alertas/ultima-mensagem"
mkdir -p "$(dirname "$state")"

show() { # mensagem do ntfy, em JSON
  local title message priority urgency icon
  title="$(jq -r '.title // "Alerta do dev"' <<< "$1")"
  message="$(jq -r '.message // ""' <<< "$1")"
  priority="$(jq -r '.priority // 3' <<< "$1")"
  case "$priority" in
    5) urgency=critical icon=dialog-error ;;
    4) urgency=normal icon=dialog-warning ;;
    *) urgency=low icon=dialog-information ;;
  esac
  notify-send --app-name="Alertas dev" --urgency="$urgency" --icon="$icon" "$title" "$message"
}

while :; do
  since="$(cat "$state" 2> /dev/null || true)"
  # Sem since, o ntfy manda so as novas; com ele, as perdidas e depois as novas.
  curl -sfN "$NTFY/$TOPIC/json${since:+?since=$since}" | while IFS= read -r line; do
    [[ "$(jq -r .event <<< "$line" 2> /dev/null)" == message ]] || continue
    show "$line"
    jq -r .id <<< "$line" > "$state"
  done
  # ntfy fora do ar (make alerts-down, docker parado): tenta de novo.
  sleep 10
done
