# Escrow incident runbook

1. Confirm Redis connectivity from every API replica.
2. Treat `ESCROW_CIRCUIT_BREAKER_READ_ERROR` as an active pause, not as permission to continue payments.
3. Inspect `/api/internal/escrow-velocity` and confirm the returned `stateUnknown` field is absent before resuming.
4. Re-enable escrow only after Redis reads succeed and an authorized operator explicitly closes the circuit.
