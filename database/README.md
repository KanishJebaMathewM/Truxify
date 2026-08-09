# 🗄️ Liquibase Database Migration Subsystem

This directory contains the **Liquibase Database Schema Version Control** configuration and migration scripts for managing PostgreSQL schema evolution, indexes, and versioned changelogs across Truxify environments.

---

## 📐 Directory Structure

```text
database/
└── liquibase/
    ├── changelog-master.xml    # Root Liquibase changelog orchestrator
    ├── changelog-v1.0.xml      # Base database schema tables & PostGIS extensions
    ├── changelog-v1.1.xml      # Index optimizations & RLS policy setup
    ├── changelog-v1.2.xml      # Escrow & Polygon wallet schema additions
    ├── changelog-v2.0.xml      # Multi-region database sharding metadata tables
    ├── liquibase.properties    # Database connection parameters template
    ├── liquibase.service.js    # Node.js programmatical Liquibase runner
    ├── docker-compose.liquibase.yml # Standalone Liquibase migration container
    ├── run-migrations.sh       # Migration execution script
    └── rollback.sh             # Migration rollback script
```

---

## 🔄 Versioned Changelogs

| Changelog File | Version | Scope |
| :--- | :--- | :--- |
| `changelog-master.xml` | — | Master include list orchestrating version order. |
| `changelog-v1.0.xml` | `v1.0` | Initial schema setup: 26 tables, PostGIS extensions, RPC functions. |
| `changelog-v1.1.xml` | `v1.1` | Performance indexes, composite keys, RLS security policies. |
| `changelog-v1.2.xml` | `v1.2` | Polygon wallet addresses, Escrow status, transaction hash fields. |
| `changelog-v2.0.xml` | `v2.0` | Geographic sharded database routing metadata tables (North/South/East/West). |

---

## 🚀 Running Migrations

```bash
# Run migrations using Docker Compose
docker compose -f database/liquibase/docker-compose.liquibase.yml up

# Rollback last 1 migration change
cd database/liquibase && ./rollback.sh 1
```
