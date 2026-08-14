#!/bin/bash

<<<<<<< HEAD
echo "🔄 Rolling back Liquibase Migrations..."

# Rollback last change
liquibase --changeLogFile=changelog-master.xml \
    --url="jdbc:postgresql://localhost:5432/truxify" \
=======
# The Liquibase changelogs describe a legacy standalone demo schema and must
# never run against the application database. They target the dedicated
# "truxify_liquibase" database — see run-migrations.sh.
LIQUIBASE_DB="${LIQUIBASE_DATABASE:-truxify_liquibase}"

if [ "$LIQUIBASE_DB" = "truxify" ] || [ "$LIQUIBASE_DB" = "postgres" ]; then
    echo "Refusing to run Liquibase against the application database '${LIQUIBASE_DB}'." >&2
    echo "The app schema is managed by supabase/migrations. Set LIQUIBASE_DATABASE to a separate database (e.g. truxify_liquibase)." >&2
    exit 1
fi

echo "🔄 Rolling back Liquibase Migrations against database '${LIQUIBASE_DB}'..."

# Rollback last change
liquibase --changeLogFile=changelog-master.xml \
    --url="jdbc:postgresql://localhost:5432/${LIQUIBASE_DB}" \
>>>>>>> upstream/main
    --username=postgres \
    --password=password \
    rollbackCount 1

<<<<<<< HEAD
echo "✅ Rollback completed!"
=======
echo "✅ Rollback completed!"
>>>>>>> upstream/main
