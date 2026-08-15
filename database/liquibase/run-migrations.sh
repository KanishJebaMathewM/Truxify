#!/bin/bash

<<<<<<< HEAD
echo "🚀 Running Liquibase Migrations..."
=======
# The Liquibase changelogs describe a legacy standalone demo schema
# (BIGINT ids, 'PENDING'/'OFFLINE' defaults, driver_id -> drivers(id)).
# They must NEVER run against the application database ("truxify", or
# Supabase's "postgres"), whose schema is owned by supabase/migrations.
# They therefore target a dedicated, clearly separate database.
LIQUIBASE_DB="${LIQUIBASE_DATABASE:-truxify_liquibase}"

if [ "$LIQUIBASE_DB" = "truxify" ] || [ "$LIQUIBASE_DB" = "postgres" ]; then
    echo "Refusing to run Liquibase against the application database '${LIQUIBASE_DB}'." >&2
    echo "The app schema is managed by supabase/migrations. Set LIQUIBASE_DATABASE to a separate database (e.g. truxify_liquibase)." >&2
    exit 1
fi

echo "🚀 Running Liquibase Migrations against database '${LIQUIBASE_DB}'..."
>>>>>>> upstream/main

# Install Liquibase (if not installed)
if ! command -v liquibase &> /dev/null; then
    echo "Installing Liquibase..."
    curl -L https://github.com/liquibase/liquibase/releases/download/v4.23.0/liquibase-4.23.0.tar.gz | tar xz
    export PATH=$PWD/liquibase:$PATH
fi

<<<<<<< HEAD
# Run migrations
liquibase --changeLogFile=changelog-master.xml \
    --url="jdbc:postgresql://localhost:5432/truxify" \
=======
# Create the dedicated database if it does not exist yet
if command -v psql &> /dev/null; then
    psql -h localhost -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${LIQUIBASE_DB}'" | grep -q 1 || \
        psql -h localhost -U postgres -c "CREATE DATABASE \"${LIQUIBASE_DB}\""
fi

# Run migrations
liquibase --changeLogFile=changelog-master.xml \
    --url="jdbc:postgresql://localhost:5432/${LIQUIBASE_DB}" \
>>>>>>> upstream/main
    --username=postgres \
    --password=password \
    update

# Check status
liquibase --changeLogFile=changelog-master.xml \
<<<<<<< HEAD
    --url="jdbc:postgresql://localhost:5432/truxify" \
=======
    --url="jdbc:postgresql://localhost:5432/${LIQUIBASE_DB}" \
>>>>>>> upstream/main
    --username=postgres \
    --password=password \
    status

<<<<<<< HEAD
echo "✅ Migrations completed successfully!"
=======
echo "✅ Migrations completed successfully!"
>>>>>>> upstream/main
