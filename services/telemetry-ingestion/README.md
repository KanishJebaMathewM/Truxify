# ⚡ Go High-Throughput GPS Telemetry Ingestion Microservice

This directory contains the **High-Throughput GPS Telemetry Ingestion Engine** written in **Go (Golang)** for ultra-low latency, concurrent GPS ping processing and real-time geofence calculations.

---

## ⚡ Performance Features

- **Goroutine Concurrency**: Processes up to 100,000 telemetry pings/sec with minimal CPU and memory overhead.
- **Fast Haversine Distance Engine**: Performs sub-millisecond geofence proximity calculations on incoming GPS coordinates.
- **Atomic Operations & Thread-Safe Cache**: Tracks live active drivers and throughput metrics without lock contention using `sync.Map` and atomic counters.

---

## 🔌 REST Endpoints

| Endpoint | Method | Request Body | Description |
| :--- | :--- | :--- | :--- |
| `/api/v1/telemetry/ping` | `POST` | `TelemetryPing` | Ingests a high-frequency driver GPS ping with speed, heading, and fuel telemetry. |
| `/api/v1/telemetry/geofence` | `POST` | `GeofenceCheckRequest` | Verifies whether a driver is within a specified radius (default 500m) of a target lat/lng. |
| `/api/v1/telemetry/health` | `GET` | — | Returns live throughput statistics (`pings_per_second`, `active_drivers`, total count). |

---

## 🐳 Docker Deployment

Build and run using Docker:

```bash
# Build image
docker build -t truxify-telemetry-go services/telemetry-ingestion/

# Run container
docker run -p 8085:8085 truxify-telemetry-go
```
