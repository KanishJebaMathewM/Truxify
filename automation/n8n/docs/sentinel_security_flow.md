# 🛡️ Truxify Smart Contract Security Sentinel Workflow

This n8n workflow monitors pending Polygon mempool transactions to protect `TruxifyEscrow.sol` from flash-loan manipulation and re-entrancy attack profiles.

```mermaid
graph TD
    A[Polygon Mempool WebSocket] --> B{Flash-Loan Heuristics Match?}
    B -- Yes --> C[POST /api/internal/defensive-pause]
    C --> D[Frontrun Emergency Contract Pause]
    B -- No --> E[Ignore Transaction]
```

## Features
- Mempool real-time WebSocket ingestion
- High-gas anomalies detection
- Automated frontrun pause defense triggering
