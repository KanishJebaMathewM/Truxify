# 🔌 Debezium PostgreSQL Change Data Capture (CDC) Pipeline

This module streams write-ahead log (WAL) updates from PostgreSQL directly into Kafka topics.

## Configuration Deployment
Deploy the config to the local Kafka Connect server endpoint using the following curl command:

```bash
curl -i -X POST -H "Content-Type: application/json" \
  --data @debezium_config.json \
  http://localhost:8083/connectors
```
