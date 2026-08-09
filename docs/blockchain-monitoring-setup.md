# Blockchain Monitoring & Alerting System

## Overview

This system provides real-time monitoring of blockchain contract events, transaction failures, and payment processing errors with automatic escalation for critical issues.

## Features

### 1. Real-Time Event Listening
- Polls Polygon blockchain for contract events
- Detects payment transactions, insurance claims, geofence breaches
- Monitors smart contract reverts and balance update failures
- Configurable polling interval (default: 12s)

### 2. Alert Routing
Routes alerts to appropriate channels based on severity:
- **CRITICAL**: Slack + SMS + Email
- **HIGH**: Slack + Email
- **MEDIUM**: Slack
- **LOW**: Dashboard only

### 3. Automatic Escalation
- No acknowledgment in 5 min → Page on-call engineer
- No resolution in 15 min → Escalate to senior engineer
- No resolution in 1 hour → Notify operations team

### 4. Monitoring Metrics
- Contract call success rate
- Payment processing latency
- Withdrawal queue depth
- Failed transaction count
- Driver payout delay average
- Geofence breach count

## Setup

### Environment Variables

```env
# Blockchain Configuration
POLYGON_RPC_URL=https://polygon-rpc.com
ESCROW_CONTRACT_ADDRESS=0x...
BLOCKCHAIN_POLL_INTERVAL_MS=12000

# Alert Recipients
ALERT_EMAIL_RECIPIENTS=alerts@truxify.io,ops@truxify.io
ALERT_SMS_RECIPIENTS=+1234567890,+0987654321

# Escalation Contacts
ON_CALL_ENGINEER=oncall@truxify.io
SENIOR_ENGINEER_CONTACTS=senior1@truxify.io,senior2@truxify.io
OPERATIONS_TEAM_CONTACTS=ops-lead@truxify.io

# Metrics Collection
METRICS_COLLECTION_INTERVAL_MS=60000
```

### Database Setup

Create the following Supabase tables:

```sql
-- Blockchain monitoring events table
CREATE TABLE blockchain_monitoring_events (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(255) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_monitoring_events_type ON blockchain_monitoring_events(type);
CREATE INDEX idx_monitoring_events_created_at ON blockchain_monitoring_events(created_at);

-- Blockchain escalations table
CREATE TABLE blockchain_escalations (
  alert_id VARCHAR(255) PRIMARY KEY,
  alert_type VARCHAR(255) NOT NULL,
  severity VARCHAR(50),
  escalation_level INT,
  created_at TIMESTAMP,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  escalation_history JSONB,
  data JSONB
);

CREATE INDEX idx_escalations_created_at ON blockchain_escalations(created_at);
CREATE INDEX idx_escalations_resolved ON blockchain_escalations(resolved);

-- Blockchain metrics table
CREATE TABLE blockchain_metrics (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT NOW(),
  contract_call_success_rate INT,
  payment_processing_latency_avg INT,
  withdrawal_queue_depth INT,
  failed_transaction_count INT,
  driver_payout_delay_avg INT,
  blocks_scanned_per_day INT,
  geofence_breach_count INT,
  insurance_events_count INT
);

CREATE INDEX idx_metrics_timestamp ON blockchain_metrics(timestamp);
```

## Event Types

### PaymentReceived
Emitted when a payment is successfully received by the driver.
- Severity: MEDIUM
- Channels: Slack

### InsuranceClaimApproved
Emitted when an insurance claim is approved by the contract.
- Severity: MEDIUM
- Channels: Slack

### InsuranceClaimRejected
Emitted when an insurance claim is rejected by the contract.
- Severity: HIGH
- Channels: Slack, Email
- Escalation: Yes

### GeofenceBreach
Emitted when a shipment exits the designated geofence.
- Severity: HIGH
- Channels: Slack, Email
- Escalation: Yes

### BalanceUpdateFailed
Emitted when earnings cannot be transferred to wallet due to contract failure.
- Severity: CRITICAL
- Channels: Slack, SMS, Email
- Escalation: Yes

### SmartContractRevert
Emitted when a transaction fails due to smart contract error (insufficient funds, permission denied, etc.).
- Severity: CRITICAL
- Channels: Slack, SMS, Email
- Escalation: Yes

## Integration

### Initialization

```javascript
import { BlockchainMonitor, AlertRouter, EscalationHandler, BlockchainMetrics } from './services/blockchain/index.js';

const metrics = new BlockchainMetrics();
const alertRouter = new AlertRouter({ notificationService, slackClient, emailService, smsService });
const escalationHandler = new EscalationHandler({ notificationService, alertRouter });
const monitor = new BlockchainMonitor({ alertRouter, metricsService: metrics, escalationHandler });

await monitor.initialize();
await monitor.startListening();
```

### Resolving Alerts

```javascript
const alertId = await escalationHandler.resolveAlert(alertId);
```

### Querying Metrics

```javascript
const metrics = await supabase
  .from('blockchain_metrics')
  .select('*')
  .order('timestamp', { ascending: false })
  .limit(24);
```

## Testing

### Manual Testing

1. Trigger a PaymentReceived event from contract
2. Verify Slack notification appears
3. Monitor escalation if alert not acknowledged

### Automated Testing

```javascript
describe('BlockchainMonitor', () => {
  test('should detect PaymentReceived events', async () => {
    const monitor = new BlockchainMonitor({ /* deps */ });
    await monitor.initialize();
    await monitor.startListening();
    
    // Simulate event
    const alert = {
      type: 'PAYMENT_RECEIVED',
      severity: 'MEDIUM',
      driver: '0x...',
      amount: '1000',
      timestamp: Date.now(),
    };
    
    // Verify routing
    expect(alertRouter.route).toHaveBeenCalledWith(alert);
  });
});
```

## Monitoring Dashboard

Access the dashboard at `/api/blockchain/metrics`:

```json
{
  "contractCallSuccessRate": 98,
  "paymentProcessingLatencyAvg": 2345,
  "withdrawalQueueDepth": 12,
  "failedTransactionCount": 3,
  "driverPayoutDelayAverage": 15,
  "blocksScanedPerDay": 120000,
  "geofenceBreachCount": 2,
  "insuranceEventsCount": 5
}
```

## Performance

- Block polling: Every 12 seconds (configurable)
- Metrics aggregation: Every 60 seconds (configurable)
- Memory usage: ~5MB for active alerts
- Database writes: ~10 writes/minute for typical volume

## Troubleshooting

### Alerts not sending
1. Check Slack/Email credentials
2. Verify ALERT_EMAIL_RECIPIENTS and ALERT_SMS_RECIPIENTS env vars
3. Check `blockchain_monitoring_events` table for event records

### High CPU usage
1. Increase BLOCKCHAIN_POLL_INTERVAL_MS (slower polling)
2. Reduce METRICS_COLLECTION_INTERVAL_MS if needed
3. Check active alerts count

### Missing events
1. Verify POLYGON_RPC_URL is correct
2. Check ESCROW_CONTRACT_ADDRESS is valid
3. Verify contract ABI matches deployed contract

## References

- [Polygon JSON-RPC](https://wiki.polygon.technology/docs/develop/ethereum-polygon/getting-started)
- [ethers.js Documentation](https://docs.ethers.org/)
- [Escrow Contract ABI](./ESCROW_CONTRACT_ABI.md)
