#!/usr/bin/env bash
# Versao da ultima migration do repositorio (o prefixo numerico do arquivo),
# no mesmo formato que o Supabase grava em supabase_migrations.schema_migrations.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ls "$root/supabase/migrations" | sed -nE 's/^([0-9]+)_.*\.sql$/\1/p' | sort | tail -1
