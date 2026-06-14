# Truxify

Broker-free, ML-powered, blockchain-secured freight platform.

Truxify connects manufacturers and truck drivers directly, with a focus on lower brokerage costs, better transparency, and simpler operations.

## Repository Layout

- `apps/customer` - Flutter customer app
- `apps/driver` - Flutter driver app
- `backend/api` - Node.js + Express API
- `backend/ml` - FastAPI machine learning service
- `blockchain` - Solidity smart contracts
- `packages/truxify_shared` - Shared Dart models and widgets
- `docs` - Architecture, setup, and schema documentation

## Getting Started

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

## Notes

- The project uses Supabase, Firebase, Redis, MongoDB, and optional blockchain services.
- See `docs/wiki/Getting-Started-&-Local-Setup.md` for the full local setup guide.
- See each app and service README for component-specific instructions.
