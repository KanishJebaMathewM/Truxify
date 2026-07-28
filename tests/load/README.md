# Truxify Load Testing

This directory contains the automated load testing scripts required for the Phase 6 Security and Scalability Audit. 

We use **[k6](https://k6.io/)** to simulate concurrent users, specifically focusing on:
1. REST API endpoints (Truck matching, profiles, etc.)
2. WebSocket connections (GPS live tracking to MongoDB)

## Prerequisites

You must have `k6` installed on your machine.
* **Mac (Homebrew):** `brew install k6`
* **Windows (Chocolatey):** `choco install k6`
* **Linux (Debian/Ubuntu):** `sudo apt install k6`

## Running the Load Test Locally

Before running the tests, ensure your local Docker Compose stack is running so the APIs and WebSockets are available.

```bash
# From the root directory, start the stack
docker-compose up -d
```

Once the stack is running, navigate to this directory and execute the test:

```bash
cd tests/load
k6 run k6-load-test.js
```

### Customizing the Target URL

If your backend is running on a different port or host (e.g. staging), you can override the environment variables:

```bash
k6 run -e BASE_URL=https://api.staging.truxify.com/api/v1 -e WS_URL=wss://api.staging.truxify.com/ k6-load-test.js
```

## Test Structure

The `k6-load-test.js` script ramps up to **100 concurrent virtual users (VUs)** over a couple of minutes. 

Each VU will:
1. Make a REST API call to `/api/v1/trucks/search` to simulate a customer searching for trucks.
2. Establish a WebSocket connection to the root endpoint.
3. Emit a `GPS_UPDATE` payload every 3 seconds to simulate a driver's live location stream.
4. Verify that 95% of HTTP requests complete in under 500ms.
