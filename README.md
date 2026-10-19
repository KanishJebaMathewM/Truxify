<img width="1536" height="1024" alt="Cover img Truxify" src="https://github.com/user-attachments/assets/eb96ea33-edb3-433a-b6b5-ecaddfc34306" />

# 🚛 Truxify

### Broker-Free · ML-Powered · Blockchain-Secured Freight Platform

**Directly connecting manufacturers and truck drivers — eliminating the middleman, maximising earnings, and bringing transparency to India's ₹14 lakh crore freight industry.**

[![Flutter](https://img.shields.io/badge/Flutter-3.x-02569B?style=flat-square&logo=flutter)](https://flutter.dev)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=flat-square&logo=nodedotjs)](https://nodejs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![Polygon](https://img.shields.io/badge/Polygon-Blockchain-8247E5?style=flat-square&logo=polygon)](https://polygon.technology)
[![License](https://img.shields.io/badge/License-MIT-00897B?style=flat-square)](https://github.com/KanishJebaMathewM/Truxify/blob/main/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen?style=flat-square)](https://github.com/KanishJebaMathewM/Truxify/blob/main/CONTRIBUTING.md)

[Overview](#-overview) · [Problem](#-the-problem) · [Solution](#-the-solution) · [Architecture](#-architecture) · [ML Layer](#-ml-layer) · [Blockchain](#-blockchain-layer) · [Getting Started](#-getting-started) · [Roadmap](#-roadmap)

---

## 📌 Overview
Truxify is an open-source, broker-free freight marketplace that connects manufacturers directly to truck drivers across India's national highway network.

India has 1.4 crore registered trucks. Most drive back empty after every delivery. Most drivers earn subsistence wages after brokers take 30–40% of every booking. Most small manufacturers still find trucks through a chain of phone calls that takes 6+ hours.

Truxify fixes all three problems simultaneously — with a platform that is open source, self-hostable, and built for the people every existing solution has ignored.

## 🏗️ Architecture Preview

```mermaid
graph TD
    Customer[Customer Flutter App]
    Driver[Driver Flutter App]

    API[Node.js + Express API]

    Supabase[(Supabase)]
    ML[FastAPI ML Engine]
    Blockchain[Polygon Smart Contracts]

    Customer --> API
    Driver --> API

    API --> Supabase
    API --> ML
    API --> Blockchain

    Manufacturer ──────────────────────────── Driver
                    TRUXIFY
         ML Matching · Blockchain Escrow
         Voice AI · Live Tracking · n8n

         ┌─────────────────────────────────────────────────────────┐
│                    FLUTTER APPS                         │
│         Customer App          Driver App                │
└──────────────────┬──────────────────────────────────────┘
                   │ REST + WebSockets
┌──────────────────▼──────────────────────────────────────┐
│              NODE.JS + EXPRESS (Main API)                │
│       Auth · Bookings · Payments · WebSocket Server         │
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
git clone [https://github.com/KanishJebaMathewM/Truxify.git](https://github.com/KanishJebaMathewM/Truxify.git)
cd Truxify/apps/customer  # or Truxify/apps/driver
flutter pub get
flutter run
cp .env.example .env
docker compose up --build
MONGODB_URI=mongodb://mongo:27017
MONGODB_DB_NAME=truxify_telemetry
REDIS_URL=redis://redis:6379
cd backend/api
npm install
cp .env.example .env
npm run dev
cd backend/api
npm test
cd apps/customer
flutter pub get
flutter analyze
flutter test
cd apps/driver
flutter pub get
flutter analyze
flutter test
cd backend/ml
pip install -r requirements.txt
python -m pytest tests/ -v
cd blockchain
npm ci
npx hardhat compile
npx hardhat test
docker compose up --build
