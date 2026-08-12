# 🔄 Kafka Event Streaming & CQRS Architecture

This directory contains the **Apache Kafka Event Streaming Engine** and **Command Query Responsibility Segregation (CQRS)** read model builders for real-time async event processing in Truxify.

---

## 📐 Directory Structure

```text
backend/kafka/
├── index.js                  # Main Kafka event bus entry point
├── package.json              # KaftaJS dependencies
├── docker-compose.kafka.yml  # Kafka broker & Zookeeper docker stack
├── config/
│   └── kafka.config.js       # KafkaJS client, broker URLs, SSL, and retry config
├── consumers/
│   └── order.consumer.js     # Async Kafka topic event consumer
├── cqrs/
│   └── order.read.model.js   # Materialized view read model generator (PostgreSQL/Redis)
├── events/
│   └── order.events.js       # Event producer & schema definitions
└── scripts/
    └── init-kafka.js         # Kafka topics auto-creation script
```

---

## ⚡ Managed Topics & Events

| Topic Name | Event Types | Consumers | Purpose |
| :--- | :--- | :--- | :--- |
| `truxify.orders.v1` | `order.created`, `order.updated`, `driver.assigned`, `payment.confirmed` | `orderConsumer` | Main order lifecycle event stream for decoupled notification, auditing, and analytics. |
| `truxify.telemetry.v1` | `location.ping`, `geofence.cross` | `telemetryConsumer` | High-throughput GPS telemetry streaming for live tracking map views. |

---

## 🚀 Running Kafka Locally

Start Kafka and Zookeeper with Docker Compose:

```bash
docker compose -f backend/kafka/docker-compose.kafka.yml up -d
```

Start the Kafka Event Bus service:

```bash
cd backend/kafka && node index.js
```
