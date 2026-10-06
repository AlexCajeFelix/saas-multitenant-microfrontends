#!/usr/bin/env bash
# ===========================================================================
# Desliga os alertas (make alerts-down): para os containers e remove o servico
# do desktop. O historico (volumes) fica; make alerts-up volta de onde parou.
# ===========================================================================
set -euo pipefail

# shellcheck source=scripts/alerts/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

unit_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT"
if [[ -f "$unit_file" ]]; then
  systemctl --user disable --now --quiet "$UNIT" 2> /dev/null || true
  rm -f "$unit_file"
  systemctl --user daemon-reload 2> /dev/null || true
fi
"${compose[@]}" down
echo "alertas desligados (o historico fica nos volumes; make alerts-up religa)"
