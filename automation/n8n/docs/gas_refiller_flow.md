# ⛽ Truxify Relayer Gas Tank Refiller & Alerting System

This n8n automated workflow manages native gas token reserves for transaction relayer wallets.

```mermaid
graph TD
    A[Interval: 5 Min Check] --> B[GET /api/internal/relayer-balance]
    B --> C{Balance < 0.05 ETH?}
    C -- Yes --> D[POST /api/internal/refill-gas-tank]
    D --> E[Trigger Admin Vault Gas Transfer]
    C -- No --> F[Log Adequate Balance]
```

## Features
- 5-minute cron check interval execution
- Dynamic gas threshold triggers
- Automated administrative vault gas top-up execution
