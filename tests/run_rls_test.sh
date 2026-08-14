#!/bin/bash
set -e

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/truxify}"

echo "Running Supabase PostgreSQL RLS Index Performance Benchmark..."
psql "$DB_URL" -f tests/rls_benchmark.sql

echo "Executing pgbench concurrency load test..."
pgbench "$DB_URL" -c 10 -j 2 -t 100 -f tests/rls_benchmark.sql

echo "RLS Benchmark completed successfully!"
