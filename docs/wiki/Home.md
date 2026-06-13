# 🚛 Welcome to the Truxify Wiki!

Welcome to the official technical documentation and wiki for **Truxify** — an open-source, broker-free, ML-powered, and blockchain-secured freight platform designed to connect manufacturers directly with truck owners/drivers across India.

Truxify is built to disrupt India's ₹14 lakh crore freight industry by eliminating middleman brokers (who take 30–40% commission), reducing empty return trips (deadheading), securing payments via blockchain escrow, and providing voice-based AI assistant interactions for drivers and small businesses.

---

## 🧭 Wiki Navigation

Use the quick links below to navigate through the technical docs:

* **[Architecture & Tech Stack](Architecture-&-Tech-Stack)**: High-level system design, service communication, and production tools.
* **[Getting Started & Local Setup](Getting-Started-&-Local-Setup)**: Run the Flutter apps, start the Express API, run the FastAPI ML engine, and launch the database stack locally.
* **[Database Schema & Flows](Database-Schema)**: Supabase PostgreSQL, MongoDB event streams, and Redis cache strategies.
* **[Machine Learning Engine](Machine-Learning-Layer)**: Deep dive into the 10 models (matching, dynamic pricing, profit prediction, VRP, demand heatmaps, etc.) running on FastAPI.
* **[Blockchain & Trust Layer](Blockchain-&-Trust-Layer)**: Trustless escrow, document hash integrity, decentralized ratings, and Polygon/Solidity smart contracts.
* **[Automation & Voice AI](Automation-&-Voice-AI)**: n8n automation pipelines, dispute resolutions, and WebRTC-based Voice AI assistant.

---

## 🏗️ System Overview (The 6-Layer Stack)

Truxify divides its responsibilities across **6 distinct layers** that work together to maintain security, verify data integrity, optimize matching, and enable modern communication channels:

```
┌─────────────────────────────────────────────────────────┐
│                    FLUTTER APPS                          │
│         Customer App          Driver App                 │
└──────────────────┬──────────────────────────────────────┘
                   │ REST + WebSockets
┌──────────────────▼──────────────────────────────────────┐
│              NODE.JS + EXPRESS (Main API)                │
│     Auth · Bookings · Payments · WebSocket Server        │
└────┬──────────────┬──────────────────────┬──────────────┘
     │              │                      │
┌────▼────┐  ┌──────▼──────┐  ┌───────────▼────────────┐
│ FASTAPI │  │  SUPABASE   │  │  POLYGON SMART CONTRACT │
│   ML    │  │  PostgreSQL │  │  Escrow · Docs · Repute │
│ Models  │  │  + PostGIS  │  └────────────────────────┘
└────┬────┘  └──────┬──────┘
     │              │
┌────▼────┐  ┌──────▼──────┐
│  OSRM   │  │  MONGODB    │
│ Routing │  │  GPS Logs   │
└─────────┘  └─────────────┘
```

1. **Client Layer (Flutter)**: Separate, responsive Android/iOS apps for Customers (manufacturers) and Drivers, built with a shared common package (`truxify_shared`).
2. **Gateway Layer (Node.js/Express)**: Core API that routes traffic, authenticates tokens, manages real-time WebSockets, and integrates with backend services.
3. **Storage Layer (PostgreSQL + Mongo + Redis)**: Multi-db setup partitioning transactional data (Supabase), high-write telemetry & GPS pings (MongoDB), and sessions/cache (Redis).
4. **Intelligence Layer (FastAPI)**: Host microservice for 10 custom machine learning models handling routing, pricing, demand prediction, and matching.
5. **Trust Layer (Polygon + Solidity)**: Decentralized ledger that locks booking payments in escrow, verifies driver document hashes, and secures portable ratings.
6. **Automation Layer (n8n)**: Workflows running dispute-resolution pipelines and triggering automated ML retraining jobs.

---

## 📅 Roadmap & Phase Progress

We are currently in **Phase 1 (Foundation)** of active development. Here is how our milestones look:

* **Phase 1 — Foundation (Current)**
  * [x] Customer App UI (Flutter)
  * [x] Driver App UI (Flutter)
  * [x] Backend API Skeleton (Node.js/Express)
  * [x] Database Schema Design & RPCs
* **Phase 2 — Core Platform**
  * [ ] User Auth (Firebase Integration)
  * [ ] Load posting & bidding flow
  * [ ] Basic ML matching integration
  * [ ] Real-time GPS tracking map (OSM/WebSockets)
* **Phase 3 — Intelligence**
  * [ ] Full 10-model ML FastAPI service
  * [ ] Dynamic pricing forecast
  * [ ] Deadhead elimination route suggestion
* **Phase 4 — Trust Layer**
  * [ ] Polygon Smart Contract deployments
  * [ ] UPI Escrow trigger integration
  * [ ] On-chain reputation & rating history
* **Phase 5 — Automation & Voice**
  * [ ] Dispute arbitration pipeline (n8n)
  * [ ] Voice AI assistant (WebRTC + Whisper + ElevenLabs)
  * [ ] Hindi, Tamil, and English localization
* **Phase 6 — Production Ready**
  * [ ] Full audits & load tests
  * [ ] Single-click Docker setup for self-hosting

---

> [!NOTE]
> All code components are designed to run on **free-tier limits** during development. Truxify is built to be self-hostable, so state transport departments, NGOs, or cooperatives can deploy the entire stack independently.
