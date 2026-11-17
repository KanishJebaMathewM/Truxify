# 📚 Truxify Documentation Index

Welcome to the technical documentation repository for **Truxify** — an open-source, broker-free, ML-powered, and blockchain-secured freight platform for India.

---

## 🏛️ Architecture & Decisions

- 🏛️ **[Architecture Decisions (ADRs)](./ARCHITECTURE_DECISIONS.md)** — **Start here!** Core technology choices, rationale, trade-offs, and contributor FAQ (Polygon, FastAPI, OSRM, n8n, Supabase+PostGIS, Hardhat).
- 🏗️ **[System Architecture](./architecture.md)** — High-level system design, sequence diagrams, 6-layer architecture, and data flows.
- 📂 **[Backend Domain ADRs](./architecture/adr/)** — Service layer decomposition, repository patterns, order lifecycle state machines, and timeline workflows.
- 🛡️ **[Middleware Architecture](./MIDDLEWARE_ARCHITECTURE.md)** — Request lifecycle, security headers, rate limiting, and timeout management.
- ⚡ **[Rate Limiting Architecture](./RATE_LIMITING_ARCHITECTURE.md)** — Multi-tier sliding window rate limiters and DDoS protection.

---

## 🌐 API & Services

- 📡 **[API Documentation Index](./api/README.md)** — Backend API service overviews and executable examples.
- 📖 **[API Reference](./docs/API_REFERENCE.md)** — REST endpoints, request payloads, and response contracts.
- ⚙️ **[Environment Setup](./environment-variables.md)** — Environment variable definitions across all services (`.env.example`).
- ⏱️ **[Health Checks & Telemetry](./HEALTH_CHECKS.md)** — Service liveness, readiness, and monitoring probes.
- 🔍 **[Error Handling Guide](./ERROR_HANDLING_GUIDE.md)** — Standard error structures and error handling patterns.

---

## 🧠 Machine Learning & Routing

- 🤖 **[ML Service Overview](./ML_SERVICE.md)** — The 10-model intelligence pipeline running on FastAPI.
- 🗺️ **[OSRM Setup Guide](./osrm-setup.md)** — Deploying and running the Open Source Routing Machine cluster.
- 📊 **[ML API Schema](./ml-api-schema.json)** — OpenAPI/Swagger JSON schema for the FastAPI ML engine.
- 💰 **[Pricing Engine](./PRICING.md)** — Dynamic freight pricing and fuel-adjusted rate calculation.
- 🎯 **[Prediction Validator](./PREDICTION_VALIDATOR.md)** — Input sanitization and bounds checking for ML inferences.

---

## ⛓️ Blockchain & Trust Layer

- 🔒 **[Escrow System](./ESCROW.md)** — Solidity smart contracts for milestone deposits and delivery payouts.
- 📈 **[Blockchain Monitoring Setup](./blockchain-monitoring-setup.md)** — Event watchers, gas monitors, and relayer alerts.
- 📜 **[DigiLocker & Document Verification](./DOCUMENT_VALIDATION.md)** — Cryptographic hashing of driver licenses, RC, and insurance docs.
- 🏆 **[Reputation & Ratings](./REPUTATION_SERVICE.md)** — On-chain verifiable driver and shipper trust scores.

---

## 💾 Database & Storage

- 🗄️ **[Database Schema](./schema.md)** — Relational table definitions, indexes, and constraints.
- 🐘 **[Supabase Setup Script](./supabase_setup.sql)** — PostgreSQL DDL, PostGIS spatial extensions, and Row-Level Security (RLS) policies.
- ⚡ **[Cache System](./CACHE_SYSTEM.md)** — Redis multi-level caching strategies and invalidation protocols.

---

## 🚀 Deployment & Operations

- 🚢 **[Deployment Guide](./deployment.md)** — Production deployment using Docker Compose, Kubernetes, and Nginx.
- 🔧 **[Troubleshooting Guide](./troubleshooting.md)** — Diagnosing common local development and production issues.
- 🚨 **[Incident Response](./INCIDENT_RESPONSE.md)** — Runbooks and triage protocols for production incidents.

---

## 📖 Wiki

Looking for guides or step-by-step tutorials? Visit the [Truxify Wiki](./wiki/Home.md):
- [Architecture & Tech Stack](./wiki/Architecture-&-Tech-Stack.md)
- [Getting Started & Local Setup](./wiki/Getting-Started-&-Local-Setup.md)
- [Database Schema & Flows](./wiki/Database-Schema.md)
- [Machine Learning Layer](./wiki/Machine-Learning-Layer.md)
- [Blockchain & Trust Layer](./wiki/Blockchain-&-Trust-Layer.md)
- [Automation & Voice AI](./wiki/Automation-&-Voice-AI.md)
