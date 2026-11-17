# 🏛️ Truxify Architecture Decision Records (ADRs)

> **Document Status**: Living Document  
> **Target Audience**: Core Maintainers, Open-Source Contributors, Architecture Reviewers  
> **Last Updated**: October 2026

Welcome to Truxify's Architecture Decision Records (ADRs). This document records the architectural and technology stack choices that power Truxify, India's open-source, broker-free freight platform.

When building a high-throughput, low-margin logistics marketplace for 1.4 crore truck drivers and millions of micro-manufacturers, several design constraints differ sharply from typical Silicon Valley SaaS applications:
1. **Zero unnecessary marginal costs**: Operating costs must not erode driver earnings or platform accessibility.
2. **Offline-first & low-bandwidth resiliency**: National highway corridors often experience degraded cellular connectivity.
3. **Strict transactional integrity alongside high-volume telemetry**: Financial escrows require absolute ACID guarantees, while real-time GPS pings generate millions of append-only events.
4. **Self-hostability**: State transport departments, logistics cooperatives, and NGOs must be able to self-host Truxify without expensive cloud lock-in.

Below are the deliberate architectural decisions that resolve these constraints, along with their trade-offs and an FAQ addressing proposals we frequently receive from new contributors.

---

## 📋 Table of Contents
- [Summary Matrix](#-summary-matrix)
- [ADR-001: Polygon PoS over Ethereum Mainnet & Solana (Trust & Escrow Layer)](#adr-001-polygon-pos-over-ethereum-mainnet--solana)
- [ADR-002: FastAPI (Python) over Node.js ML Libraries (Intelligence Layer)](#adr-002-fastapi-python-over-nodejs-ml-libraries)
- [ADR-003: Open Source Routing Machine (OSRM) over Google Maps Directions API (Routing Layer)](#adr-003-open-source-routing-machine-osrm-over-google-maps-directions-api)
- [ADR-004: Self-Hosted n8n over Zapier, Make, or Custom Cron Jobs (Automation Layer)](#adr-004-self-hosted-n8n-over-zapier-make-or-custom-cron-jobs)
- [ADR-005: Supabase (PostgreSQL + PostGIS) + MongoDB Hybrid over Pure MongoDB (Data Layer)](#adr-005-supabase-postgresql--postgis--mongodb-hybrid-over-pure-mongodb)
- [ADR-006: Hardhat over Foundry or Truffle (Smart Contract Tooling)](#adr-006-hardhat-over-foundry-or-truffle)
- [❓ Questions We Get a Lot (FAQ)](#-questions-we-get-a-lot-faq)
- [Submitting a New Architecture Proposal (RFC)](#submitting-a-new-architecture-proposal-rfc)

---

## 📊 Summary Matrix

| Layer | Chosen Technology | Primary Alternatives Rejected | Decisive Reason |
| :--- | :--- | :--- | :--- |
| **Trust & Escrow** | **Polygon PoS** | Ethereum Mainnet, Solana, Private Hyperledger | ~0.001 MATIC gas vs $5–50 ETH; EVM contract reusability; 2s block finality. |
| **ML Engine** | **FastAPI (Python)** | Node.js (TensorFlow.js/Brain.js), Flask, Django | First-class OR-Tools / SciPy / LightGBM ecosystem; async throughput; strict Pydantic schemas; CPU isolation from gateway event loop. |
| **Routing & Distance** | **OSRM (Self-Hosted)** | Google Maps Directions API, Mapbox, GraphHopper | Zero marginal cost at scale ($0 vs $2,500+/batch); microsecond routing with Contraction Hierarchies; self-hostable offline. |
| **Async Automation** | **n8n (Self-Hosted)** | Zapier, Make, Custom cron scripts, Airflow | Zero per-task SaaS fees; data privacy (driver PII stays in-house); visual canvas for disputes and retraining workflows. |
| **Persistence** | **Supabase (PostgreSQL + PostGIS) + MongoDB** | Pure MongoDB for everything, Pure PostgreSQL for everything | ACID guarantees + PostGIS geospatial joins for orders/escrow; sharded MongoDB for high-write GPS telemetry streams. |
| **Smart Contracts** | **Hardhat (TypeScript)** | Foundry, Truffle (deprecated), Brownie | Shared TypeScript tooling with Node.js backend; rich plugin ecosystem; Solidity `console.log` and stack traces. |

---

## ADR-001: Polygon PoS over Ethereum Mainnet & Solana

### Status
**Accepted & Implemented**

### Context
Truxify replaces predatory middlemen (who skim 30–40% commission) with trustless cryptographic escrow. The platform handles:
1. Advance payment locks upon booking acceptance.
2. Milestone-based partial payouts upon verified checkpoint arrival.
3. Final balance release upon delivery OTP verification.
4. Tamper-proof notarization of driver document hashes (RC, commercial insurance, driving license) and delivery receipts.
5. Portable, on-chain driver reputation scores.

In Indian freight, trips range from short intra-city transfers (₹1,500 – ₹5,000) to cross-country container movements (₹30,000 – ₹80,000). A technology that charges excessive fees or introduces slow block confirmations destroys the micro-economic viability of single-truck owner-operators.

### Decision
Deploy Truxify smart contracts (`Escrow.sol`, `DocumentRegistry.sol`, `Reputation.sol`) onto the **Polygon PoS (Proof of Stake)** network.

### Reasons
- **Micro-Cent Gas Economics**: Average transaction fees on Polygon PoS range between 0.0005 to 0.002 POL/MATIC (~₹0.05 to ₹0.20). In contrast, Ethereum L1 gas fees fluctuate from $3 to $50+ (₹250 to ₹4,000+), which would devour up to 50% of an intra-city freight margin on transaction fees alone.
- **Fast Block Times (~2 Seconds)**: High-speed 2-second block finality gives drivers and shippers immediate confirmation at warehouse check-ins, toll gates, and unloading bays without waiting 12–15 minutes for Ethereum PoS epoch finality.
- **Full EVM Compatibility**: Developers write standard Solidity contracts and utilize the vast Ethereum security tooling (OpenZeppelin audit-tested escrow patterns, Hardhat, Ethers.js). The contract codebase can seamlessly bridge or migrate to Polygon zkEVM or Ethereum Layer 2 rollups (Arbitrum, Optimism) without code rewrites.
- **Why not Solana?**:
  - Solana is not EVM-compatible; smart contracts must be written in Rust using Anchor, isolating contract code from Truxify's primary TypeScript/Node.js backend ecosystem.
  - Higher node infrastructure requirements and historical network instability/congestion during high load made it riskier for mission-critical freight escrow.
  - EVM tooling provides mature, standardized account-abstraction and meta-transaction relayers (EIP-2771 / Biconomy), enabling Truxify to sponsor gas fees on behalf of truck drivers who do not possess crypto wallets.

### Trade-offs & Mitigations
- **Trade-off**: Lower degree of decentralization and smaller validator set (~100 validators) compared to Ethereum L1 mainnet.
  - *Mitigation*: Multi-sig governance controls and state root checkpoints posted periodically to Ethereum L1 provide robust finality guarantees.
- **Trade-off**: Occasional RPC latency or gas spikes during high-volume network events.
  - *Mitigation*: The backend utilizes a multi-provider fallback RPC pool with automatic failover and local transaction nonce management.

---

## ADR-002: FastAPI (Python) over Node.js ML Libraries

### Status
**Accepted & Implemented**

### Context
Truxify's competitive advantage over traditional freight boards is its unified machine learning and operational research layer. Truxify runs 10 interconnected models:
1. Two-Sided Bilateral Matcher (matching truck capacity to load requirements).
2. Driver Profit Predictor (estimating net revenue after diesel, toll, and wear-and-tear).
3. 3D Bin Packing & Vehicle Routing Problem (VRP) solver.
4. Collaborative Filter for personalized route recommendations.
5. Dynamic Freight Price Forecaster (seasonal & fuel-indexed time-series).
6. ETA Predictor with highway topography adjustments.
7. Trust & Fraud Risk Scorer.
8. Deadhead Eliminator (backhaul load scanner).
9. Demand Heatmap Forecaster.
10. Live Mid-Trip Re-optimizer.

New contributors frequently ask: *"Why not write the ML models in Node.js using Brain.js or TensorFlow.js to keep a single-language JavaScript codebase?"*

### Decision
Maintain the Machine Learning engine as a dedicated microservice in **FastAPI (Python 3.11+)**, isolated from the Node.js Express API gateway.

### Reasons
- **Mathematical & Operational Research Ecosystem**: High-performance combinatorial solvers (Google OR-Tools for VRP and 3D bin packing) and gradient boosting libraries (`LightGBM`, `XGBoost`, `CatBoost`) have mature, highly-optimized C++/Python bindings. Equivalent production-grade solvers do not exist natively in Node.js.
- **Asynchronous Throughput with ASGI**: FastAPI runs on Starlette and Uvicorn (`uvloop`), delivering benchmark speeds comparable to Go and Node.js while supporting native async/await for I/O operations.
- **Strict Data Validation with Pydantic v2**: Logistics models accept deeply nested parameters (geographic coordinates, vehicle dimensions, axle weights, commodity classifications). Pydantic automatically validates request schemas with zero boilerplate and exports OpenAPI specifications that client services consume.
- **CPU Event Loop Isolation**: Machine learning inference and optimization algorithms are CPU-bound. If executed inside the Node.js process, long-running combinatorial computations (e.g. 500ms–2000ms VRP solving) would block the single-threaded Node.js event loop, freezing real-time WebSocket GPS telemetry and HTTP request routing for all connected mobile clients.

### Trade-offs & Mitigations
- **Trade-off**: Polyglot architecture requires developers to maintain both JavaScript/TypeScript and Python runtime environments.
  - *Mitigation*: Both services are containerized via Docker and orchestrated with `docker-compose.yml`. Mock ML mode allows frontend and backend developers to develop locally without requiring Python ML dependencies.
- **Trade-off**: Inter-service network serialization overhead (~2–5ms).
  - *Mitigation*: High-frequency prediction results (such as route pricing matrices and demand heatmaps) are cached in Upstash Redis.

---

## ADR-003: Open Source Routing Machine (OSRM) over Google Maps Directions API

### Status
**Accepted & Implemented**

### Context
To calculate fair pricing, estimate driver fuel consumption, order multi-stop delivery drop-offs, and suggest deadhead elimination backhauls, Truxify must calculate route distances and transit times across thousands of waypoint permutations continuously.

### Decision
Deploy a self-hosted **Open Source Routing Machine (OSRM)** cluster using **OpenStreetMap (OSM)** data for all system distance, duration, and routing calculations, combined with native Google Maps deep-links for driver turn-by-turn navigation.

### Reasons
- **Zero Marginal Cost at Scale**:
  - Google Maps Directions API costs **$5.00 per 1,000 requests**, and the Distance Matrix API costs **$5.00 to $10.00 per 1,000 elements**.
  - Truxify's bilateral matching algorithm evaluates matrices of up to 500 loads against 1,000 nearby drivers (500,000 matrix elements) per batch.
  - Executing a single batch through Google Maps would cost **$2,500+ per run**, amounting to tens of thousands of dollars daily.
  - Self-hosted OSRM runs on standard cloud instances at fixed, predictable compute cost ($20–$50/month) with unlimited route computations.
- **Sub-Millisecond Routing with Contraction Hierarchies (CH)**:
  - OSRM pre-processes the road network graph using Contraction Hierarchies, allowing it to compute shortest path and distance matrices in sub-millisecond speeds.
  - This extreme speed enables combinatorial solvers (such as VRP stop-sequencing and mid-trip route re-optimization) to iterate thousands of candidate paths in real time.
- **Self-Hostability & Privacy**:
  - State governments, port authorities, and logistics co-ops can run the entire Truxify platform inside private networks without transmitting spatial trip coordinates to third-party proprietary map providers.
- **Driver Turn-by-Turn UX without API Fees**:
  - Inside the Truxify Driver App, clicking "Start Navigation" triggers a native OS deep-link (`geo:` or `google.navigation:q=...`), launching the driver's preferred navigation app (Google Maps or MapMyIndia) with pre-filled waypoints. This incurs **$0 API cost** to Truxify while providing drivers with the voice navigation experience they already trust.

### Trade-offs & Mitigations
- **Trade-off**: OSRM routes are based on static OSM graph profiles and do not natively include live traffic jams or temporary road closures.
  - *Mitigation*: Truxify's ML ETA predictor model incorporates historical highway speeds, time-of-day traffic models, and weather feeds on top of OSRM base metrics.
- **Trade-off**: Memory footprint during graph compilation for large geographic regions.
  - *Mitigation*: Pre-built routing datasets for India (`india-latest.osrm`) are compiled on dedicated build machines and mounted to lightweight Docker containers in production.

---

## ADR-004: Self-Hosted n8n over Zapier, Make, or Custom Cron Jobs

### Status
**Accepted & Implemented**

### Context
Truxify requires reliable, event-driven automation for auxiliary business workflows:
1. Automated dispute arbitration escalation (e.g. if a customer or driver does not submit unloading verification within 48 hours, lock escrow and alert support).
2. Weekly ML model retraining pipeline trigger, benchmark validation, and automatic rollback on accuracy regressions.
3. Driver document expiration warnings and DigiLocker re-verification alerts.
4. Failed webhook Dead Letter Queue (DLQ) retry and notification protocols.

### Decision
Deploy an open-source, self-hosted instance of **n8n** connected directly to Truxify internal webhooks and database triggers.

### Reasons
- **Strict Data Sovereignty & Zero SaaS Per-Task Costs**:
  - Platforms like Zapier and Make charge steep per-task subscription fees and require streaming sensitive freight manifests, driver Aadhaar/license documents, and payment details to external commercial clouds.
  - Self-hosted n8n runs within Truxify's VPC, ensuring 100% data sovereignty and zero marginal execution costs.
- **Visual Observability for Operational Teams**:
  - Support agents, dispute managers, and data scientists can inspect visual execution histories, identify failing webhook steps, and trace payloads without digging through server log files.
- **Why not Custom Cron Jobs / BullMQ for everything?**:
  - Writing raw cron scripts or custom worker consumers for complex multi-step notification and escalation logic introduces heavy code maintenance overhead.
  - n8n provides built-in conditional branching, error triggers, wait states, rate-limiting, and retries out-of-the-box.
- **Why not Apache Airflow or Temporal?**:
  - Airflow and Temporal introduce significant architectural complexity, requiring dedicated orchestrators, worker fleets, and specialized Python/Go DSLs. n8n strikes the ideal balance of lightweight deployment and intuitive visual workflow construction.

### Trade-offs & Mitigations
- **Trade-off**: Additional service container to deploy, monitor, and back up (n8n metadata stored in PostgreSQL).
  - *Mitigation*: Managed as a standard service definition inside `docker-compose.yml` and automated via standard GitHub Actions CI.
- **Trade-off**: Not suited for sub-second, high-throughput streaming (e.g., GPS pings).
  - *Mitigation*: Real-time GPS pings bypass n8n entirely, flowing directly from WebSockets to MongoDB and Redis.

---

## ADR-005: Supabase (PostgreSQL + PostGIS) + MongoDB Hybrid over Pure MongoDB

### Status
**Accepted & Implemented**

### Context
A freight platform deals with two conflicting categories of data:
1. **Financial & Relational Core**: Orders, bids, escrow deposits, user identities, driver KYC verifications, milestone progressions, and wallet balances.
2. **High-Frequency Telemetry**: Real-time GPS pings from tens of thousands of active trucks transmitting location coordinates every 5–10 seconds, IoT temperature readings, sensor streams, and historical ML training logs.

New contributors often ask: *"Why maintain both PostgreSQL and MongoDB? Can't MongoDB handle the whole application?"*

### Decision
Adopt **polyglot persistence**:
- **Supabase (PostgreSQL + PostGIS)**: Relational data, financial ledgers, and spatial geofence matching.
- **MongoDB Atlas**: High-write, append-only GPS telemetry and raw ML event logs.

### Reasons
- **ACID Transactions & Foreign-Key Integrity**:
  - Bids, order states, and wallet balances require strict atomicity and isolation. For example, when a shipper accepts a bid via `accept_bid_tx`, the database must atomically reserve the escrow, update order status to `in_progress`, decline competing bids, and create the initial trip milestone.
  - Relational foreign keys and row-level locking (`SELECT ... FOR UPDATE`) prevent double-booking trucks and race conditions that would cause severe real-world financial disputes.
- **Geospatial Power with PostGIS**:
  - PostGIS is the industry standard for spatial joins, polygon geofencing around logistics warehouses, and corridor proximity queries (`ST_DWithin`, GiST spatial indexes).
- **Supabase Features (RLS & RPCs)**:
  - Supabase provides built-in Row-Level Security (RLS) policies, ensuring users only read their own sensitive documents and shipment records.
- **Preventing PostgreSQL Table Bloat with MongoDB**:
  - 50,000 trucks sending location pings every 5 seconds generate **36,000,000 writes per hour**.
  - Writing this transient, append-only stream into transactional PostgreSQL would bloat WAL logs, inflate B-tree indexes, and trigger aggressive autovacuum locks, degrading core order-processing performance.
  - MongoDB excels at high-throughput write ingestion, capped collections, flexible time-series collections, and automated TTL (Time-To-Live) data expiration.

### Trade-offs & Mitigations
- **Trade-off**: Dual-database maintenance and differing query syntax across backend services.
  - *Mitigation*: The Node.js API isolates data access into dedicated repositories: `OrderRepository` for Supabase/PostgreSQL, and `TrackerRepository` for MongoDB telemetry.
- **Trade-off**: Eventual consistency between GPS positions and order statuses.
  - *Mitigation*: Only the latest current coordinate pointer is referenced in PostgreSQL, while the exhaustive GPS breadcrumb trail is archived in MongoDB.

---

## ADR-006: Hardhat over Foundry or Truffle

### Status
**Accepted & Implemented**

### Context
Truxify's smart contracts govern escrow releases, notarized document hashes, and driver reputation scores on the Polygon blockchain. We needed a reliable, reproducible development, testing, and deployment environment.

### Decision
Use **Hardhat** (with TypeScript and Ethers.js) as the primary smart contract development environment.

### Reasons
- **Unified TypeScript Ecosystem with Node.js Backend**:
  - Truxify's API gateway is written in JavaScript/Node.js using `ethers.js`. Hardhat scripts, contract tests, and deployment recipes are written in TypeScript/JavaScript.
  - Contract ABIs and type definitions (`TypeChain`) generated during compilation are directly consumed by the backend API without manual export/conversion pipelines.
- **In-Memory Network with `console.log` and Clear Revert Traces**:
  - Hardhat Network allows logging directly from Solidity code (`import "hardhat/console.sol"; console.log(...)`), pinpointing logic errors in multi-milestone escrow releases during local testing.
- **Why not Truffle?**:
  - Truffle was officially deprecated by ConsenSys in 2023, and maintenance has ceased.
- **Why not Foundry?**:
  - While Foundry is exceptionally fast and compiles Solidity-native tests, it requires Rust toolchains and CLI scaffolding to export artifacts into a Node.js runtime. For Truxify's current team and contributor base, Hardhat provides a frictionless, zero-setup onboarding experience using familiar `npm` / `npx` workflows.

### Trade-offs & Mitigations
- **Trade-off**: Test execution is slower than Foundry's compiled native Rust runner.
  - *Mitigation*: Smart contract surface area is intentionally small and focused (3 primary contracts); full test suites execute in under 10 seconds locally.

---

## ❓ Questions We Get a Lot (FAQ)

### Q1: "Can we rewrite the Python ML service in TypeScript/Node.js so everything is in one language?"
**Answer: No.**  
While having a single language sounds appealing, Node.js lacks the mathematical and operational research libraries Truxify requires. Specifically:
- Google OR-Tools (used for the NP-hard 3D Bin Packing and Multi-Stop Vehicle Routing Problem) has no production-grade Node.js equivalent.
- Machine learning libraries like LightGBM, XGBoost, and PyTorch are first-class citizens in Python.
- Running heavy combinatorial optimization in Node.js would block the event loop, freezing API and WebSocket responses.

### Q2: "Why not replace OSRM with Google Maps Directions API to get live traffic?"
**Answer: Cost at scale.**  
Truxify's bilateral matching algorithm evaluates up to 500,000 route combinations in a single batch. On Google Maps, this would cost $2,500+ *per batch*. Self-hosted OSRM computes these routes in microseconds for $0 marginal cost.  
For driver turn-by-turn navigation on the road, the Driver App launches Google Maps externally via native phone deep-links, giving drivers live voice navigation at zero cost to the platform.

### Q3: "Isn't using both Supabase and MongoDB redundant? Can't we just pick one?"
**Answer: No; they solve fundamentally different problems.**  
- **Supabase (PostgreSQL + PostGIS)** gives us strict ACID transactions, row-level locking, foreign-key referential integrity for escrow payments and order statuses, plus geospatial queries.
- **MongoDB** ingests millions of high-frequency GPS location pings that would overwhelm and fragment a relational database.  
Splitting transactional data from high-write telemetry keeps both databases fast and reliable.

### Q4: "Why not use Solana instead of Polygon for faster transaction speeds?"
**Answer: EVM compatibility, gas sponsorship, and ecosystem stability.**  
Polygon PoS delivers 2-second block times and sub-cent fees (~₹0.10), which is more than fast enough for freight milestones. Crucially, Polygon is fully EVM-compatible, enabling us to use battle-tested OpenZeppelin escrow contracts and EIP-2771 meta-transaction relayers so drivers can use the platform without paying their own crypto gas fees. Solana requires Rust, different wallet infrastructures, and lacks comparable EVM relayer standards.

### Q5: "Why not replace n8n with custom cron jobs or Celery/BullMQ?"
**Answer: Observability and developer velocity.**  
Dispute escalation rules, retraining triggers, and notification pipelines evolve frequently as business operations scale. n8n allows operations and engineering to inspect execution histories, step through failed steps, and modify workflows visually without shipping code redeployments for simple logic changes.

### Q6: "Can we switch the smart contract tooling from Hardhat to Foundry?"
**Answer: We prefer Hardhat for unified TypeScript tooling.**  
Hardhat allows the blockchain suite and the Node.js backend to share dependencies, TypeScript interfaces, and ABI artifacts directly. If you want to use Foundry for local fuzz testing or invariant analysis, you are welcome to submit an RFC, but Hardhat remains the default build and deployment tool for CI/CD.

### Q7: "How do I propose a major architectural or technology stack change?"
**Answer: Open an RFC (Request for Comments) issue before writing code.**  
We welcome improvements, but replacing foundational technologies (e.g. database engines, blockchain networks, routing layers) requires rigorous evaluation against Truxify's core constraints (zero marginal cost, self-hostability, low-bandwidth resilience). Please follow the RFC process outlined below.

---

## 📝 Submitting a New Architecture Proposal (RFC)

If you believe an existing architectural decision should be revisited or wish to propose a new technology:

1. **Check existing ADRs**: Review this document and the detailed domain ADRs in [`docs/architecture/adr/`](file:///c:/Users/hp/Desktop/nsoc/Truxify/Truxify/docs/architecture/adr/).
2. **Open an Issue**: Use the title format `[RFC]: Your Proposal Name`.
3. **Structure Your Proposal**:
   - **Context**: What problem are we solving?
   - **Proposed Decision**: What technology/pattern are you introducing?
   - **Alternatives Evaluated**: What other solutions exist?
   - **Economic Impact**: How does this affect operating and cloud infrastructure costs?
   - **Trade-offs**: What complexity or downsides are introduced?
4. **Community Discussion**: Allow core maintainers and contributors at least 7 days to evaluate and discuss before opening a pull request.
