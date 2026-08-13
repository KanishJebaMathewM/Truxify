# 🔄 Kafka Event Streaming & CQRS Architecture

This directory contains the **Apache Kafka Event Streaming Engine** and **Command Query Responsibility Segregation (CQRS)** read model builders for real-time async event processing in Truxify.

## ⚡ AUTHORITATIVE ORDER-EVENT PIPELINE (Issue #1)

```
ORDER MUTATION
      ↓
DATABASE TRANSACTION        (trigger `trg_orders_event_outbox`, same txn)
      ├── update orders
      └── create durable outbox event  (event_outbox table)
              ↓
            COMMIT
              ↓
      OUTBOX RELAY           (relay/outbox.relay.js, run from index.js)
              ↓
            KAFKA
              ↓
         CONSUMER            (consumers/order.consumer.js)
              ↓
   SINGLE READ MODEL         (orders_read_model, applied atomically with the
                              kafka_processed_events idempotency record via
                              the apply_order_event RPC)
```

Key facts:

- `event_outbox` is the **durable, transactional event log**. The order event is
  written in the same database transaction as the order mutation, so a failure
  on either side rolls both back.
- The relay publishes with the **real order id as the Kafka key** (`aggregateId`),
  never the event id (`eventId`). `eventId` is the idempotency key only.
- The consumer applies each event **atomically** to `orders_read_model` +
  `kafka_processed_events` (`apply_order_event` RPC). Duplicates, replays and
  consumer restarts are safe.
- Backfill existing orders (idempotent, safe to re-run):
  `node scripts/backfill-orders.js`.

## 📐 Directory Structure

```text
backend/kafka/
├── index.js                  # Main Kafka event bus entry point (relay + consumers)
├── package.json              # KaftaJS dependencies
├── docker-compose.kafka.yml  # Kafka broker & Zookeeper docker stack
├── config/
│   └── kafka.config.js       # KafkaJS client, broker URLs, SSL, and retry config
├── consumers/
│   └── order.consumer.js     # Async Kafka topic event consumer
├── cqrs/
│   └── order.read.model.js   # SINGLE authoritative read-model writer (orders_read_model)
├── relay/
│   └── outbox.relay.js       # Transactional outbox -> Kafka relay
├── repositories/
│   ├── outbox.repository.js      # Outbox claim/publish/mark adapters
│   ├── processedEvent.repository.js  # Idempotency registry (side-effect topics)
│   └── event.repository.js       # LEGACY `events` table adapter (deprecated)
├── events/
│   └── order.events.js       # Event producer & schema definitions
└── scripts/
    ├── init-kafka.js         # Kafka topics auto-creation script
    └── backfill-orders.js    # Idempotent read-model + outbox backfill
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
