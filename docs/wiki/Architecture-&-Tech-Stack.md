# 🏗️ System Architecture & Tech Stack

Truxify is designed as a distributed, decoupled, 6-layer architecture. It leverages microservices, smart contracts, and real-time streams to connect manufacturers and truck drivers directly and securely.

---

## 🗺️ High-Level Architecture Diagram

```mermaid
graph TB
    subgraph CLIENTS["📱 Client Layer"]
        CA["Customer App<br/><small>Flutter</small>"]
        DA["Driver App<br/><small>Flutter</small>"]
    end

    subgraph GATEWAY["🌐 API Gateway"]
        API["Node.js + Express<br/><small>REST API + WebSocket</small>"]
    end

    subgraph INTELLIGENCE["🧠 Intelligence Layer"]
        ML["FastAPI ML Engine<br/><small>10 Models</small>"]
        N8N["n8n Automation<br/><small>Disputes + Retraining</small>"]
    end

    subgraph DATA["💾 Data Layer"]
        PG["Supabase<br/><small>PostgreSQL — 27 tables</small>"]
        MONGO["MongoDB Atlas<br/><small>GPS pings + ML data</small>"]
        REDIS["Upstash Redis<br/><small>Sessions + Cache</small>"]
    end

    subgraph TRUST["⛓️ Trust Layer"]
        POLY["Polygon Blockchain<br/><small>Escrow + Docs + Reputation</small>"]
    end

    subgraph INFRA["☁️ Infrastructure"]
        FB["Firebase<br/><small>Auth + FCM</small>"]
        R2["Cloudflare R2<br/><small>File Storage + CDN</small>"]
        OSRM["OSRM<br/><small>Route Engine</small>"]
    end

    CA & DA -->|REST + WS| API
    API --> PG
    API --> MONGO
    API --> REDIS
    API --> ML
    API --> POLY
    API --> FB
    API --> R2
    ML --> OSRM
    N8N --> API
    N8N --> ML
```

---

## 🎛️ Service Responsibilities

Truxify divides data storage and functionality across specialized micro-backends to maximize scalability and cost-efficiency:

| Service | Technology | Role & Responsibility |
| :--- | :--- | :--- |
| **Mobile Apps** | Flutter | Frontend for Customers (to post loads, track trips, run voice queries) and Drivers (to accept offers, get turn-by-turn navigation, upload documents). |
| **Main API Gateway** | Node.js + Express | Handles HTTP routing, WebSocket connections for live tracking, Firebase JWT authentication, transactional database triggers, and smart contract relayer integrations. |
| **ML Engine** | FastAPI + Python | Hosts 10 connected machine learning models for dynamic pricing, route sequence planning, cargo-to-truck matching, and return-load recommendations. |
| **Primary Relational DB** | Supabase (PostgreSQL + PostGIS) | Houses the core relational schema (27 tables) for user profiles, order metadata, bids, trips, financial ledger records, and ratings. Uses stored procedures (RPCs) for atomic wallet and order transactions. |
| **Event Database** | MongoDB Atlas | Stores high-frequency, non-relational telemetry data: driver GPS pings, user activity events, and historical telemetry data used for offline ML model retraining. |
| **Caching & Sessions** | Upstash Redis | Manages user session state, caches database query results (5-minute TTL), tracks rate-limit counters, and maintains driver presence records. |
| **Object Storage** | Cloudflare R2 | Stores unstructured binary assets such as driver license PDFs, vehicle registration RC scans, profile photos, and invoice receipts using time-limited pre-signed URLs. |
| **Trust Layer** | Polygon Ledger + Solidity | Custodies trustless payment escrows, records cryptographic hashes of driver verifications on-chain, issues immutable delivery receipts, and aggregates permanent driver ratings. |
| **Routing Service** | Open Source Routing Machine (OSRM) | Computes distances, durations, and multi-stop optimal routes using free OpenStreetMap data, bypassing Google Maps API charges. |

---

## 🔄 Data Flow: The Order Lifecycle

The sequence diagram below represents how an order transitions from placement to delivery, highlighting the interaction between the frontend, Node.js gateway, PostgreSQL database, and Polygon ledger:

```mermaid
sequenceDiagram
    participant C as Customer App
    participant API as Node.js API
    participant PG as Supabase
    participant D as Driver App
    participant BC as Polygon

    Note over C,BC: 1. BOOKING
    C->>API: POST /api/orders (cargo + route)
    API->>PG: INSERT orders + order_timeline
    API->>PG: INSERT load_offers (broadcast to nearby)
    API-->>C: Order created ✅

    Note over C,BC: 2. BIDDING
    D->>API: GET /api/orders (view load offers)
    API->>PG: SELECT load_offers WHERE status='available'
    API-->>D: Load list
    D->>API: POST /api/orders/:id/bids (bid_amount)
    API->>PG: INSERT load_bids
    API-->>D: Bid submitted ✅

    Note over C,BC: 3. BID ACCEPTANCE
    C->>API: GET /api/orders/:id/bids (view bids)
    API->>PG: SELECT load_bids + profile + vehicle info
    API-->>C: Enriched bid list
    C->>API: POST /api/orders/:id/bids/:bidId/accept
    API->>PG: RPC accept_bid_tx (locks order, assigns driver)
    API-->>C: Driver assigned ✅

    Note over C,BC: 4. ACTIVE TRIP
    D->>API: WebSocket GPS pings
    API->>PG: UPDATE trips / trip_stops
    API-->>C: Real-time location via WebSockets

    Note over C,BC: 5. DELIVERY & ESCROW RELEASE
    D->>API: Confirm delivery (provide OTP from customer)
    API->>PG: RPC complete_trip_tx (atomic wallet settlement)
    API->>BC: Mint on-chain delivery receipt & unlock escrow
    API-->>D: Wallet credited ✅
    API-->>C: Order delivered ✅

    Note over C,BC: 6. RATING
    C->>API: POST /api/ratings (stars + comment)
    API->>PG: RPC submit_rating_tx (update database averages)
    API->>BC: Write permanent reputation on-chain
```

---

## 💾 Data Partitioning Strategy

Data in Truxify is classified into three temperature paths to optimize resource usage, query speeds, and cloud costs:

```mermaid
graph TB
    subgraph HOT["🔥 Hot Path (Real-time)"]
        GPS["GPS Pings<br/><small>MongoDB — write-heavy, TTL indexed</small>"]
        SESS["Sessions<br/><small>Redis — 24hr TTL</small>"]
        CACHE["API Cache<br/><small>Redis — 5min TTL</small>"]
    end

    subgraph WARM["🟡 Warm Path (Transactional)"]
        ORDERS["Orders + Bids<br/><small>Supabase — ACID, RLS</small>"]
        WALLET["Wallet + Earnings<br/><small>Supabase — Atomic RPCs</small>"]
        TRIPS["Trips + Stops<br/><small>Supabase — relational</small>"]
    end

    subgraph COLD["🧊 Cold Path (Archive)"]
        DOCS["Document Files<br/><small>Cloudflare R2 — immutable</small>"]
        CHAIN["On-chain Records<br/><small>Polygon — permanent</small>"]
        ML_DATA["ML Training Data<br/><small>MongoDB — batch reads</small>"]
    end

    GPS -.->|batch ETL| ML_DATA
    ORDERS -.->|on delivery| CHAIN
    TRIPS -.->|on completion| WALLET
```

* **Hot Path (In-Memory/NoSQL)**: Handles high-throughput writes (WebSocket GPS coordinate telemetry stream) and fast-read checks (user session tokens, API rate limits).
* **Warm Path (Relational RDBMS)**: Manages structured, ACID-compliant business transactions (placing orders, accepting bids, updating driver wallet balances). Row-Level Security (RLS) is strictly enforced here.
* **Cold Path (Storage/Blockchain)**: Archival documents (license scans in Cloudflare R2), immutable receipts (blockchain smart contract logs), and historical tracking points (MongoDB offline training collections).

---

## 🔒 Security Model

Security is applied at the application, transport, database, and ledger levels:

* **Authentication**: Managed primarily via Firebase Auth, where the frontend logs in via phone number (OTP) and obtains a JWT token. Additionally, the WebSocket tracking endpoint supports both Firebase and Supabase JWT tokens for upgrade authentication. The token is passed in the `Authorization: Bearer <token>` header of HTTP requests, or as a query parameter for WebSocket connections.
* **Authorization**: The Node.js `auth.js` middleware validates the Firebase token for API routes, and the WebSocket tracking router verifies the respective Firebase or Supabase JWT on connection upgrades. The API then fetches the user profile from Supabase and binds user identity and role properties to the request or socket context.
* **Database Isolation**: Row-Level Security (RLS) policies are active on PostgreSQL. Clients never talk to Supabase directly; they interact only with the Express API. The API uses a secure `SUPABASE_SERVICE_ROLE_KEY` to perform authorized operations under strict API validation.
* **Data Integrity**: Financial ledger transactions (allocating pending balances, withdrawing funds) are processed inside Supabase using Postgres functions with explicit `SELECT ... FOR UPDATE` row locking to prevent race conditions or double-spending.
