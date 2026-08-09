# 🔄 Truxify Multi-Oracle Gas & Escrow Sync Workflow

This n8n workflow guarantees idempotent synchronization between Polygon blockchain RPC gas price feeds, Chainlink exchange rate oracles, and backend database transaction tables.

```mermaid
graph TD
    A[Cron Trigger: Every 5 Mins] --> B[HTTP Request: Polygon RPC eth_gasPrice]
    B --> C[n8n JS Code: Compute Idempotency Key]
    C --> D{Already Processed?}
    D -- Yes --> E[Skip Execution]
    D -- No --> F[Update Supabase Database State]
```

## Features
- Multi-RPC failover fetching
- Idempotency key generation (`gas_sync_<5_min_window>`)
- Zero duplicate transaction writes
