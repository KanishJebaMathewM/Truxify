#!/bin/bash

echo "🔄 Rolling back Liquibase Migrations..."

# Rollback last change
liquibase --changeLogFile=changelog-master.xml \
    --url="jdbc:postgresql://localhost:5432/truxify" \
    --username=postgres \
    --password=password \
    rollbackCount 1

echo "✅ Rollback completed!"