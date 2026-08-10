# Blockchain Metrics

`BlockchainMetrics` tracks on-chain health and payment metrics, aggregated
periodically into the `blockchain_metrics` table.

## Record methods

| Method                          | Effect                                          |
| ------------------------------- | ----------------------------------------------- |
| `recordPaymentEvent(status)`    | Success: `rate = rate*0.9 + 10`; failure decays by 0.95. |
| `recordPaymentLatency(ms)`      | Appends to latency buffer (capped at 1000).     |
| `recordWithdrawalQueueDepth(n)` | Stores the depth.                               |
| `recordFailedTransaction()`     | Increments failed count.                        |
| `recordDriverPayoutDelay(min)`  | Running average with existing value.            |
| `recordBlockScan(count)`        | Adds to blocks scanned per day.                 |
| `recordGeofenceBreach()`        | Increments breach count.                        |
| `recordInsuranceEvent(status)`  | Increments insurance event count.               |
| `recordBalanceUpdateFailure()`  | Increments failed count.                        |
| `recordContractRevert()`        | Increments failed count.                        |

## Aggregation

`aggregateMetrics()` writes a snapshot row every
`METRICS_COLLECTION_INTERVAL_MS` (default 60000ms) and resets the daily
block-scan counter. Failures are logged, not thrown.

## Read

`getMetrics()` returns the live in-memory snapshot including
`paymentProcessingLatencyAvg`.

## Configuration

| Env var                         | Default  |
| ------------------------------- | -------- |
| `METRICS_COLLECTION_INTERVAL_MS`| 60000    |
