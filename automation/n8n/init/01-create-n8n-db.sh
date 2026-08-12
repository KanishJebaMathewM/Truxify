#!/bin/sh
set -eu

# Create a dedicated, least-privilege PostgreSQL role and database for the n8n
# automation service. n8n connects ONLY to `truxify_n8n` and has no access to
# the application's `truxify` database (orders, wallets, PII).
#
# Runs once on first initialization of the `postgres_data` volume by the
# postgres docker-entrypoint. `N8N_DB_PASSWORD` is sourced from the container
# environment (`.env` via `env_file`).

if [ -z "${N8N_DB_PASSWORD:-}" ]; then
  echo "ERROR: N8N_DB_PASSWORD is required to provision the n8n database" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<EOSQL
CREATE ROLE n8n LOGIN PASSWORD '${N8N_DB_PASSWORD}';
CREATE DATABASE truxify_n8n OWNER n8n;
EOSQL
