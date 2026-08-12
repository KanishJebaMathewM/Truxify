# 🗄️ Liquibase Database Migration Subsystem

> **⚠️ Legacy standalone schema — dedicated database required**
>
> These changelogs define a legacy demo schema (`users`/`drivers`/`orders`
> with BIGINT ids, `'PENDING'`/`'OFFLINE'` defaults) that is **not** the
> application schema. The application schema (`profiles`/`driver_details`/
> `orders`, uuid ids, lowercase status CHECKs) is owned by
> [`supabase/migrations`](../supabase/migrations) and must remain the single
> source of truth for the application database.
>
> To prevent either system from breaking the other, every Liquibase entry
> point here targets the dedicated **`truxify_liquibase`** database (override
> with `LIQUIBASE_DATABASE`), and a guard refuses to run against the
> application database names (`truxify`/`postgres`).

This directory contains the **Liquibase Database Schema Version Control** configuration and migration scripts for managing PostgreSQL schema evolution, indexes, and versioned changelogs across Truxify environments.

---

## 📐 Directory Structure

```text
database/
└── liquibase/
    ├── changelog-master.xml    # Root Liquibase changelog orchestrator
    ├── changelog-v1.0.xml      # Legacy demo schema: users / drivers / orders
    ├── changelog-v1.1.xml      # Legacy demo schema: payments / escrow
    ├── changelog-v1.2.xml      # Legacy demo schema: KYC / location / blockchain fields
    ├── changelog-v2.0.xml      # Legacy demo schema: audit log + triggers
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
| `changelog-v1.0.xml` | `v1.0` | Legacy demo tables: users, drivers, orders. |
| `changelog-v1.1.xml` | `v1.1` | Legacy demo tables: payments, escrow. |
| `changelog-v1.2.xml` | `v1.2` | Legacy demo additions: KYC, location, blockchain fields. |
| `changelog-v2.0.xml` | `v2.0` | Legacy demo: audit_log table + triggers. |

---

## 🚀 Running Migrations

All scripts below apply the changelogs to the dedicated **`truxify_liquibase`**
database. They refuse to run against the application database.

```bash
# Run migrations using Docker Compose (its own postgres container + DB)
docker compose -f database/liquibase/docker-compose.liquibase.yml up

# Run migrations against a local truxify_liquibase database
cd database/liquibase && ./run-migrations.sh

# Rollback last 1 migration change
cd database/liquibase && ./rollback.sh 1
```

To use a different dedicated database name, set `LIQUIBASE_DATABASE`
(e.g. `LIQUIBASE_DATABASE=truxify_liquibase_dev ./run-migrations.sh`).
