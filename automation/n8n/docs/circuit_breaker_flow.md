# ⚡ Truxify Emergency Smart Contract Circuit Breaker Workflow

This automated n8n workflow monitors contract balance deltas over 1-minute windows to protect `TruxifyEscrow.sol` from unauthorized high-velocity drain attacks.

```mermaid
graph TD
    A[Cron: 1 Min Monitor] --> B[GET /api/internal/escrow-velocity]
    B --> C{Drain Anomaly Detected?}
    C -- Yes --> D[POST /api/internal/pause-escrow]
    D --> E[Trigger TruxifyEscrow.pause()]
    C -- No --> F[Log Normal State]
```

## Features
- Real-time 1-minute velocity monitoring
- Automated call execution to `TruxifyEscrow.pause()`
- Alert notifications dispatched to system admins
