# Truxify

Broker-free, ML-powered, blockchain-secured freight platform.

Truxify connects manufacturers and truck drivers directly so freight bookings can be handled with less brokerage overhead, better transparency, and more control for both sides.

## Overview

Truxify is a monorepo with two Flutter apps and a multi-service backend stack:

- `apps/customer` - Customer-facing Flutter app for booking and tracking freight
- `apps/driver` - Driver-facing Flutter app for trips, loads, and delivery flow
- `backend/api` - Node.js + Express API gateway and orchestration layer
- `backend/ml` - FastAPI service for ML predictions and matching helpers
- `blockchain` - Solidity contracts for escrow and trust-related flows
- `packages/truxify_shared` - Shared Dart models, repositories, and UI pieces
- `docs` - Architecture, schema, and setup documentation

## What Truxify Includes

- freight booking and order tracking
- driver and customer mobile experiences
- delivery verification and live trip flows
- backend orchestration for auth, orders, and tracking
- ML-assisted routing and matching
- blockchain components for trust and escrow

## Getting Started

For a full setup walkthrough, see `docs/wiki/Getting-Started-&-Local-Setup.md`.

### Backend API

```bash
cd backend/api
cp .env.example .env
npm install
npm run dev
```

### Driver App

```bash
cd apps/driver
flutter pub get
flutter run
```

### Customer App

```bash
cd apps/customer
flutter pub get
flutter run
```

### Run With Docker

```bash
cp .env.example .env
docker compose up --build
```

The Compose stack overrides the cloud MongoDB and Redis placeholders from `.env` inside the API container:

```env
MONGODB_URI=mongodb://mongo:27017
MONGODB_DB_NAME=truxify_telemetry
REDIS_URL=redis://redis:6379
```

## Backend Development Setup

The backend lives in `backend/api`:

```bash
cd backend/api
npm install
cp .env.example .env
npm run dev
```

Available commands:

```bash
npm run dev
npm start
npm test
```

## Development Notes

- The project uses Supabase, Firebase, Redis, MongoDB, and optional blockchain services.
- The backend is split into route handlers, middleware, services, and tests under `backend/api`.
- The Flutter apps use `--dart-define` for configuration where needed.
- Keep environment-specific values out of source control.

## Project Vision

Truxify exists to remove broker dependency from freight booking and improve trust across the shipment lifecycle.

### The Problem

```
Manufacturer -> Broker -> Sub-Broker -> Truck Owner -> Driver
     OK              Fee          Fee            Fee          Frustration
```

By the time money reaches the driver, a large percentage is already lost to commissions and delays.

### The Solution

| Feature | Traditional Market | Truxify |
|---|---|---|
| Open Source | Proprietary | Fully open and self-hostable |
| Matching | Manual or basic | ML-assisted load and truck matching |
| Payment | Delayed settlement | Escrow-backed delivery release |
| Tracking | Limited | Live tracking and route visibility |
| Reputation | Platform-owned | On-chain and portable |

### Architecture

| Layer | Technology | Purpose |
|---|---|---|
| Customer App | Flutter | Booking, tracking, profile management |
| Driver App | Flutter | Loads, trips, verification flow |
| Main API | Node.js + Express | REST API, WebSockets, orchestration |
| ML Engine | FastAPI + Python | Matching, prediction, optimization |
| Blockchain | Polygon + Solidity | Escrow, docs, reputation |
| Automation | n8n | Disputes and retraining triggers |

### ML Layer

Truxify uses multiple ML models for routing, pricing, matching, and trust scoring. The current design includes:

- bilateral matching
- driver profit prediction
- route and load packing
- demand forecasting
- ETA prediction
- deadhead elimination

### Blockchain Layer

Polygon smart contracts are used for:

- trustless payment escrow
- document integrity
- on-chain delivery receipts
- driver reputation tracking

### App Screens

#### Customer App

| Screen | Purpose |
|---|---|
| Home | Active shipments, quick stats, recent routes |
| Find Trucks | Search and match loads |
| Truck Results | Ranked truck matches |
| Orders | Active and past shipments |
| Live Tracking | Map, current location, and voice help |
| Order Detail | Timeline, receipt, and payment details |
| Profile | Settings, documents, and saved data |

#### Driver App

| Screen | Purpose |
|---|---|
| Home | Trip status, earnings, and demand heatmap |
| Active Trip | Stops, route, and OTP verification |
| Available Loads | Browse matching loads |
| En-Route Loads | Mid-trip load suggestions |
| Past Trips | History and earnings breakdown |
| Profile | Truck details, documents, and availability |

### Roadmap

- Phase 1: Foundation
- Phase 2: Core platform
- Phase 3: Intelligence
- Phase 4: Trust layer
- Phase 5: Automation + Voice
- Phase 6: Production readiness

## Useful References

- `docs/wiki/Getting-Started-&-Local-Setup.md`
- `docs/wiki/Architecture-&-Tech-Stack.md`
- `backend/api/README.md`
- `apps/driver/README.md`
- `apps/customer/README.md`
