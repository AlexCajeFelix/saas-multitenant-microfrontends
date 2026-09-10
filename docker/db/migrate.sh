#!/bin/sh
# Aplica as migrations em ordem alfabetica. Reexecutavel.
set -eu

echo "==> aguardando o Postgres"
until pg_isready -q; do sleep 1; done

echo "==> aguardando o GoTrue criar auth.users"
tries=0
while [ "$(psql -tAc "select to_regclass('auth.users') is not null")" != "t" ]; do
  tries=$((tries + 1))
  if [ "$tries" -gt 90 ]; then
    echo "auth.users nao apareceu; o servico 'auth' subiu? (docker compose logs auth)" >&2
    exit 1
  fi
  sleep 2
done

for file in /supabase/migrations/*.sql; do
  echo "==> $(basename "$file")"
  psql -v ON_ERROR_STOP=1 -v pgpass="$POSTGRES_PASSWORD" -q -o /dev/null -f "$file"
done

echo "==> migrations aplicadas"
