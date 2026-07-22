#!/bin/bash

echo "🚀 Running Liquibase Migrations..."

# Install Liquibase (if not installed)
if ! command -v liquibase &> /dev/null; then
    echo "Installing Liquibase..."
    curl -L https://github.com/liquibase/liquibase/releases/download/v4.23.0/liquibase-4.23.0.tar.gz | tar xz
    export PATH=$PWD/liquibase-4.23.0:$PATH
fi

# Run migrations
liquibase --changeLogFile=changelog-master.xml \
    --url="jdbc:postgresql://localhost:5432/truxify" \
    --username=postgres \
    --password=password \
    update

# Check status
liquibase --changeLogFile=changelog-master.xml \
    --url="jdbc:postgresql://localhost:5432/truxify" \
    --username=postgres \
    --password=password \
    status

echo "✅ Migrations completed successfully!"