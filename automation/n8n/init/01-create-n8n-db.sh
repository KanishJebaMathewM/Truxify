
#!/bin/sh
set -eu

# ============================================================
# Truxify - Dedicated PostgreSQL Provisioning for n8n
# ============================================================
#
# Purpose:
#   Create an isolated PostgreSQL role and database for n8n.
#
# Database:
#   truxify_n8n
#
# Role:
#   n8n
#
# Security:
#   - Least-privilege role
#   - No superuser permissions
#   - No role/database creation permissions
#   - No replication permissions
#   - Dedicated database ownership
#   - No application database grants
#
# Execution:
#   Runs during the first initialization of the PostgreSQL
#   Docker volume through docker-entrypoint-initdb.d.
#
# ============================================================

echo "================================================"
echo " Truxify PostgreSQL - n8n Database Provisioning"
echo "================================================"

# 1. Validate environment variables
: "${POSTGRES_USER:?ERROR: POSTGRES_USER is required}"
: "${POSTGRES_DB:?ERROR: POSTGRES_DB is required}"
: "${N8N_DB_PASSWORD:?ERROR: N8N_DB_PASSWORD is required}"

if [ -z "$N8N_DB_PASSWORD" ]; then
    echo "ERROR: n8n database password cannot be empty" >&2
    exit 1
fi

echo "[1/4] Environment validation successful."

# 2. Connect to the PostgreSQL initialization database
echo "[2/4] Connecting to PostgreSQL..."

psql \
    --no-psqlrc \
    --quiet \
    --set=ON_ERROR_STOP=1 \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --set=n8n_pwd="$N8N_DB_PASSWORD" <<'EOSQL'

-- 3. Create a dedicated least-privilege role if it does not exist.
SELECT format(
    'CREATE ROLE n8n LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    :'n8n_pwd'
)
WHERE NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'n8n'
)
\gexec

-- Ensure the role has the expected security settings and password.
ALTER ROLE n8n
    WITH LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS
    PASSWORD :'n8n_pwd';

-- 4. Create the dedicated database if it does not exist.
SELECT
    'CREATE DATABASE truxify_n8n OWNER n8n'
WHERE NOT EXISTS (
    SELECT 1
    FROM pg_database
    WHERE datname = 'truxify_n8n'
)
\gexec

-- Ensure the correct database ownership.
ALTER DATABASE truxify_n8n OWNER TO n8n;

-- Restrict default database-level access.
REVOKE ALL ON DATABASE truxify_n8n FROM PUBLIC;

-- Grant required database permissions to n8n.
GRANT CONNECT, TEMPORARY ON DATABASE truxify_n8n TO n8n;

EOSQL

echo "[3/4] n8n role and database provisioned successfully."

# 5. Completion
echo "[4/4] PostgreSQL provisioning completed."

echo "================================================"
echo " SUCCESS: n8n database is ready!"
echo " Database : truxify_n8n"
echo " Role     : n8n"
echo " Access   : Dedicated database"
echo "================================================"
