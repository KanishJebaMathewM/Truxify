# 🚀 Getting Started & Local Setup

This guide walks you through setting up the Truxify monorepo on your local machine for development. Truxify runs a hybrid stack of Flutter client apps, a Node.js Express server, a FastAPI Python service, a local Polygon/Hardhat environment, and databases running in Docker.

---

## 📋 Prerequisites

Before starting, ensure you have the following installed:

* **Flutter SDK 3.x** (with Android Studio or Xcode for mobile emulators)
* **Node.js 20.x** + npm
* **Python 3.10+** + pip (virtual environments recommended)
* **Docker Desktop** (or Docker engine with Compose V2)
* **Git**

---

## 📁 Repository Structure

Truxify is structured as a monorepo:

```text
Truxify/
├── apps/
│   ├── customer/          # Flutter customer (manufacturer) app
│   └── driver/            # Flutter driver app
├── backend/
│   ├── api/               # Node.js + Express API Gateway
│   └── ml/                # FastAPI + Python Machine Learning Engine
├── blockchain/            # Polygon Solidity contracts (Hardhat project)
├── automation/            # n8n automation pipeline json configurations
├── packages/
│   └── truxify_shared/    # Shared Dart package for apps (models, styles)
├── docs/                  # System diagrams, SQL schema, migrations, and wiki
└── docker-compose.yml     # Local database & services launcher
```

---

## ⚙️ Step 1: Clone the Repository & Configure `.env`

1. Clone the repository to your local machine:
   ```bash
   git clone https://github.com/KanishJebaMathewM/Truxify.git
   cd Truxify
   ```

2. Copy the example root environment file to `.env`:
   ```bash
   cp .env.example .env
   ```
   *Note: For local development, placeholder values are provided. Keep sensitive keys out of version control.*

---

## 🐳 Step 2: Spin Up the Database Stack (Docker Compose)

Truxify utilizes Docker Compose to run PostgreSQL (with PostGIS extensions), MongoDB, and Redis.

Start the database services in the background:
```bash
docker compose up -d db mongo redis
```

This starts the databases on their default ports:
* **PostgreSQL**: `localhost:5432`
* **MongoDB**: `localhost:27017`
* **Redis**: `localhost:6379`

---

## 💾 Step 3: Initialize the Supabase (PostgreSQL) Database

To set up the 27 database tables and required RPC functions:

1. Ensure the PostgreSQL container is active.
2. Open your preferred SQL client (e.g., pgAdmin, DBeaver) or run the SQL script using your client, pointing to `postgresql://postgres:postgres@localhost:5432/postgres`.
3. Execute the contents of [`docs/supabase_setup.sql`](file:///c:/Users/Admin/Desktop/Truxify/docs/supabase_setup.sql) to set up all tables, indices, and functions.
4. Execute any outstanding migrations located in [`docs/migrations/`](file:///c:/Users/Admin/Desktop/Truxify/docs/migrations/) if you are catching up to the latest features.

---

## 🌐 Step 4: Run the Backend Express API

The gateway server coordinates authentication, web sockets, database transactions, and blockchain relaying.

1. Navigate to the backend directory:
   ```bash
   cd backend/api
   ```
2. Install npm packages:
   ```bash
   npm install
   ```
3. Copy the backend-specific environment template:
   ```bash
   cp .env.example .env
   ```
   *(Ensure credentials match your local Docker database ports and Firebase configurations)*
4. Run the API server in development mode (with hot-reloading):
   ```bash
   npm run dev
   ```
   The API will run at **`http://localhost:5000`**. You can verify it by checking `http://localhost:5000/health`.

---

## 🧠 Step 5: Run the FastAPI ML Engine

The ML engine runs demand forecasting and matching calculations on FastAPI.

1. Navigate to the ML folder:
   ```bash
   cd ../ml
   ```
2. Create and activate a Python virtual environment:
   * **Windows**:
     ```bash
     python -m venv venv
     venv\Scripts\activate
     ```
   * **macOS / Linux**:
     ```bash
     python3 -m venv venv
     source venv/bin/activate
     ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the development server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   The service will be available at **`http://localhost:8000`**. You can view the interactive API swagger documentation at **`http://localhost:8000/docs`**.

---

## ⛓️ Step 6: Set Up Blockchain (Hardhat Polygon local node)

Truxify uses smart contracts to manage trustless escrow and reputational scoring.

1. Navigate to the blockchain directory:
   ```bash
   cd ../../blockchain
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment config:
   ```bash
   cp .env.example .env
   ```
4. Start a local Ethereum/Polygon network node:
   ```bash
   npx hardhat node
   ```
   This will spin up a local JSON-RPC server at `http://127.0.0.1:8545` and print 20 test accounts with private keys.
5. In a new terminal tab (keeping the node running), deploy the smart contracts:
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```
   Save the outputted contract addresses (e.g., `Escrow` and `Reputation`) and add them to your `backend/api/.env` file.

---

## 📱 Step 7: Launch the Mobile Client Apps

Ensure you have your Android emulator or iOS simulator running, or connect a physical device in developer mode.

### Running the Customer App
1. Open a terminal and navigate to the customer app directory:
   ```bash
   cd apps/customer
   ```
2. Fetch Flutter packages:
   ```bash
   flutter pub get
   ```
3. Launch the application:
   ```bash
   flutter run
   ```

### Running the Driver App
1. Navigate to the driver app directory:
   ```bash
   cd ../driver
   ```
2. Fetch Flutter packages:
   ```bash
   flutter pub get
   ```
3. Launch the application:
   ```bash
   flutter run
   ```

---

## 🎛️ Docker Compose for the Full Stack

If you do not want to run individual command lines, you can run the full backend ecosystem (Express API, MongoDB, PostgreSQL, Redis, FastAPI ML Engine) inside a unified container stack:

```bash
docker compose up --build
```

### Local Services URL Directory
Once the Docker containers or local commands are running, you can reach endpoints at:
* **Node.js Express API**: `http://localhost:5000`
* **FastAPI ML Swagger Docs**: `http://localhost:8000/docs` (or `http://localhost:8001/docs` in Docker Compose)
* **Local Hardhat RPC Node**: `http://localhost:8545`
* **PostgreSQL Connection String**: `postgresql://postgres:postgres@localhost:5432/postgres`
* **MongoDB Connection URI**: `mongodb://localhost:27017`
* **Redis Connection URI**: `redis://localhost:6379`
