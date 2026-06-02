# 🏗️ Truxify — System Architecture

> Broker-free freight platform connecting manufacturers directly to truck drivers across India.

---

## High-Level Architecture

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
        PG["Supabase<br/><small>PostgreSQL — 26 tables</small>"]
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

    style CLIENTS fill:#3498db,color:#fff
    style GATEWAY fill:#2c3e50,color:#fff
    style INTELLIGENCE fill:#9b59b6,color:#fff
    style DATA fill:#27ae60,color:#fff
    style TRUST fill:#e67e22,color:#fff
    style INFRA fill:#7f8c8d,color:#fff
```

---

## Data Flow — Order Lifecycle

```mermaid
sequenceDiagram
    participant C as Customer App
    participant API as Node.js API
    participant PG as Supabase
    participant D as Driver App
    participant BC as Polygon

    Note over C,BC: 1. BOOKING
    C->>API: POST /orders (cargo + route)
    API->>PG: INSERT orders + order_timeline
    API->>PG: INSERT load_offers (auto-broadcast)
    API-->>C: Order created ✅

    Note over C,BC: 2. BIDDING
    D->>API: GET /load_offers (available loads)
    API->>PG: SELECT load_offers WHERE status='available'
    API-->>D: Load list
    D->>API: POST /orders/:id/bids (bid_amount)
    API->>PG: INSERT load_bids
    API-->>D: Bid submitted ✅

    Note over C,BC: 3. BID ACCEPTANCE
    C->>API: GET /orders/:id/bids (view bids)
    API->>PG: SELECT load_bids + profiles + driver_details + trucks
    API-->>C: Enriched bid list
    C->>API: POST /orders/:id/bids/:bidId/accept
    API->>PG: RPC accept_bid_tx (atomic)
    API-->>C: Driver assigned ✅

    Note over C,BC: 4. ACTIVE TRIP
    D->>API: WebSocket GPS pings
    API->>PG: UPDATE trips / trip_stops
    API-->>C: Real-time location via WS

    Note over C,BC: 5. DELIVERY + PAYMENT
    D->>API: Confirm delivery (OTP)
    API->>PG: RPC complete_trip_tx (atomic)
    API->>BC: Record on-chain receipt
    API-->>D: Wallet credited ✅
    API-->>C: Order delivered ✅

    Note over C,BC: 6. RATING
    C->>API: POST /ratings (stars + comment)
    API->>PG: RPC submit_rating_tx (atomic)
    API->>BC: Write reputation on-chain
```

---

## Service Responsibilities

### Where Each Service Lives

```mermaid
graph LR
    subgraph SUPABASE["Supabase (PostgreSQL)"]
        direction TB
        S1["Profiles & Auth lookups"]
        S2["Orders & Bookings"]
        S3["Load marketplace & Bids"]
        S4["Trips & Route data"]
        S5["Wallet & Earnings"]
        S6["Documents metadata"]
        S7["Notifications & FAQs"]
        S8["Ratings & Milestones"]
    end

    subgraph MONGODB["MongoDB Atlas"]
        direction TB
        M1["Live GPS pings"]
        M2["Driver activity events"]
        M3["ML training datasets"]
        M4["Telemetry history"]
    end

    subgraph REDIS_STORE["Upstash Redis"]
        direction TB
        R1["User sessions"]
        R2["API response cache"]
        R3["Rate limit counters"]
        R4["Real-time presence"]
    end

    subgraph CLOUDFLARE["Cloudflare R2"]
        direction TB
        C1["Profile photos"]
        C2["Document scans"]
        C3["Invoice PDFs"]
    end

    subgraph FIREBASE_SVC["Firebase"]
        direction TB
        F1["Phone OTP auth"]
        F2["JWT token verification"]
        F3["Push notifications (FCM)"]
    end

    subgraph BLOCKCHAIN["Polygon"]
        direction TB
        B1["Payment escrow"]
        B2["Document hash integrity"]
        B3["Delivery receipts"]
        B4["Driver reputation scores"]
    end

    style SUPABASE fill:#27ae60,color:#fff
    style MONGODB fill:#4db33d,color:#fff
    style REDIS_STORE fill:#dc382d,color:#fff
    style CLOUDFLARE fill:#f38020,color:#fff
    style FIREBASE_SVC fill:#ffca28,color:#000
    style BLOCKCHAIN fill:#8247e5,color:#fff
```

---

## Backend API Routes

### Implemented Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `POST` | `/api/orders` | ✅ | customer | Create a new order + auto-broadcast load offer |
| `GET` | `/api/orders/history` | ✅ | customer | Fetch customer's order history |
| `GET` | `/api/orders/:id` | ✅ | any | Fetch order detail + timeline + driver info |
| `POST` | `/api/orders/:id/bids` | ✅ | driver | Submit bid on a load offer |
| `GET` | `/api/orders/:id/bids` | ✅ | customer | View all bids with enriched driver profiles |
| `POST` | `/api/orders/:id/bids/:bidId/accept` | ✅ | customer | Accept bid (calls `accept_bid_tx` RPC) |
| `GET` | `/api/drivers/stats` | ✅ | driver | Fetch driver stats + truck details |
| `PUT` | `/api/drivers/online` | ✅ | driver | Toggle online/offline status |
| `GET` | `/api/drivers/wallet/history` | ✅ | driver | Fetch wallet transaction history |
| `GET` | `/api/drivers/earnings/summary` | ✅ | driver | Fetch daily earnings chart data |
| `POST` | `/api/drivers/wallet/withdraw` | ✅ | driver | Withdraw funds (calls `withdraw_funds_tx` RPC) |

### Auth Flow

```mermaid
flowchart LR
    A["Client sends<br/>Firebase ID token"] --> B["auth.js middleware"]
    B --> C{"Test mode<br/>header?"}
    C -->|Yes| D["Use x-user-id<br/>+ x-user-role headers"]
    C -->|No| E["Verify token with<br/>Firebase Admin SDK"]
    E --> F["Lookup profile in<br/>Supabase by firebase_uid"]
    F --> G["Attach user to req.user"]
    D --> G
    G --> H["Route handler executes"]
```

---

## Technology Stack

### Production Stack

| Layer | Service | Purpose | Pricing |
|-------|---------|---------|---------|
| **Mobile** | Flutter 3.x | Customer + Driver apps | Free |
| **Auth** | Firebase Auth | Phone OTP + JWT tokens | Free tier |
| **Push** | Firebase FCM | Push notifications | Free |
| **API** | Node.js + Express | REST + WebSocket server | Render free tier |
| **ML** | FastAPI + Python | 10 ML models | Render free tier |
| **Primary DB** | Supabase (PostgreSQL) | 26 tables, RPC functions | Free tier (500MB) |
| **GPS/Events** | MongoDB Atlas | Live pings, telemetry | Free tier (512MB) |
| **Cache** | Upstash Redis | Sessions, rate limits | Free tier (10K/day) |
| **Storage** | Cloudflare R2 | Documents, photos | Free tier (10GB) |
| **Blockchain** | Polygon | Escrow, receipts, reputation | ~$0.001/tx |
| **Routing** | OSRM (self-hosted) | Distance + duration calc | Free (OSM data) |
| **Maps** | OSM + Leaflet | Customer live tracking | Free |
| **Navigation** | Google Maps deep link | Driver turn-by-turn | Free |
| **Automation** | n8n (self-hosted) | Disputes + ML retraining | Free |
| **Monitoring** | Sentry | Error tracking | Free tier |
| **CI/CD** | GitHub Actions | Build + test | Free |

### Why These Choices?

> [!NOTE]
> Every service was chosen to run on **free tiers** during development and early production. Truxify is designed so a state transport department or NGO can self-host the entire platform at near-zero cost.

---

## Directory Structure

```
Truxify/
├── apps/
│   ├── customer/          # Flutter customer app
│   │   └── lib/
│   │       ├── screens/   # UI screens
│   │       ├── widgets/   # Reusable components
│   │       ├── data/      # Mock data (until Supabase integration)
│   │       └── theme/     # Design system
│   └── driver/            # Flutter driver app
│       └── lib/
│           ├── screens/
│           ├── widgets/
│           ├── data/
│           └── theme/
├── backend/
│   └── api/               # Node.js + Express API
│       └── src/
│           ├── config/    # db.js (Supabase + MongoDB + Redis init)
│           ├── middleware/ # auth.js (Firebase + Supabase verify)
│           ├── routes/    # orderRoutes.js, driverRoutes.js
│           └── sockets/   # WebSocket GPS tracking
├── blockchain/            # Polygon smart contracts (Solidity)
├── automation/            # n8n workflow definitions
├── docs/
│   ├── architecture.md    # ← You are here
│   ├── schema.md          # Database schema visualization
│   ├── supabase_setup.sql # One-shot DB setup for contributors
│   ├── supabase_drop_all.sql
│   ├── supabase_schema.sql
│   ├── supabase_queries.sql
│   └── migrations/
│       ├── 01_rpc_transactions.sql
│       └── 02_patch_missing.sql
├── .env.example           # All service credentials template
├── docker-compose.yml
└── README.md
```

---

## Data Partitioning Strategy

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

    style HOT fill:#e74c3c,color:#fff
    style WARM fill:#f39c12,color:#fff
    style COLD fill:#3498db,color:#fff
```

---

## Environment Variables

All services are configured via a single `.env` file at the project root. See [`.env.example`](../.env.example) for the full template.

| Group | Variables | Used By |
|-------|----------|---------|
| **Supabase** | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | Backend API |
| **MongoDB** | `MONGODB_URI`, `MONGODB_DB_NAME` | Backend API, ML Engine |
| **Redis** | `REDIS_URL`, `REDIS_REST_URL`, `REDIS_REST_TOKEN` | Backend API |
| **Firebase** | `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_API_KEY` | Backend API, Flutter apps |
| **Cloudflare R2** | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Backend API |
| **Polygon** | `POLYGON_RPC_URL`, `REPUTATION_CONTRACT_ADDRESS`, `RELAYER_WALLET_PRIVATE_KEY` | Backend API |
| **Routing** | `ROUTING_API_KEY` | ML Engine |

---

## Security Model

```mermaid
flowchart TB
    subgraph AUTH["Authentication"]
        A1["Firebase Auth<br/><small>Phone OTP → JWT</small>"]
    end

    subgraph AUTHZ["Authorization"]
        A2["Backend middleware<br/><small>Verify JWT + role check</small>"]
        A3["Supabase RLS<br/><small>Row-level security policies</small>"]
    end

    subgraph INTEGRITY["Data Integrity"]
        A4["Atomic RPCs<br/><small>FOR UPDATE locks</small>"]
        A5["Blockchain hashes<br/><small>Document + receipt verification</small>"]
    end

    subgraph STORAGE_SEC["Storage Security"]
        A6["R2 pre-signed URLs<br/><small>Time-limited access</small>"]
        A7["Service role key<br/><small>Server-side only, never in client</small>"]
    end

    A1 --> A2
    A2 --> A3
    A3 --> A4
    A4 --> A5
    A2 --> A6
    A2 --> A7

    style AUTH fill:#27ae60,color:#fff
    style AUTHZ fill:#2c3e50,color:#fff
    style INTEGRITY fill:#8e44ad,color:#fff
    style STORAGE_SEC fill:#e67e22,color:#fff
```

> [!IMPORTANT]
> The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and must **never** be exposed to client apps. It's used only in the Node.js backend. Flutter apps authenticate via Firebase and call the backend API — they never talk to Supabase directly.

---

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Customer App (Flutter) | ✅ Frontend complete | Mock data, no Supabase SDK yet |
| Driver App (Flutter) | ✅ Frontend complete | Mock data, no Supabase SDK yet |
| Backend API (Node.js) | ✅ Core routes live | Orders, bids, wallet, driver stats |
| Database (Supabase) | ✅ 26 tables + 4 RPCs | Schema finalized, seed data included |
| Auth (Firebase) | 🔧 Integrated in backend | Middleware working, test mode available |
| GPS Tracking (MongoDB) | 🔧 WebSocket handler built | `tracker.js` handles live pings |
| ML Engine (FastAPI) | 📋 Planned | Skeleton exists in `backend/ml/` |
| Blockchain (Polygon) | 📋 Planned | Contract directory exists |
| Automation (n8n) | 📋 Planned | Workflow definitions pending |
| Voice AI | 📋 Planned | WebRTC + Whisper + LLM stack |
