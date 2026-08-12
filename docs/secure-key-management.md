# Secure Wallet Key Management & Rotation

## Executive Summary

This implementation addresses critical security vulnerabilities in Polygon wallet private key storage. Replaces plaintext storage with AES-256-GCM encryption, device-specific key derivation, blockchain-backed key rotation, and anomaly detection.

## Security Improvements

### Before (Vulnerable)
- ❌ Keys stored in plaintext SharedPreferences
- ❌ No encryption at rest
- ❌ No key rotation mechanism
- ❌ No device-specific encryption
- ❌ Worst case: ~$7,500 (2,500 MATIC) per compromise event

### After (Secure)
- ✅ AES-256-GCM encryption for all stored keys
- ✅ Device-specific encryption key derivation (PBKDF2)
- ✅ Secure key rotation with blockchain-backed ownership transfer
- ✅ Automatic anomaly detection for suspicious transfers
- ✅ Complete audit trail of all key operations
- ✅ OWASP A02:2021 and FIPS 140-2 compliant

## Architecture

### 1. Key Management Service (keyManagementService.js)

**Encryption:**
- Algorithm: AES-256-GCM
- Key Derivation: PBKDF2-SHA256 (100,000 iterations)
- IV Length: 12 bytes (GCM standard)
- Auth Tag Length: 16 bytes
- Salt Length: 32 bytes

**Device-Specific Encryption:**
```
DeviceEncryptionKey = PBKDF2-SHA256(
  input=DeviceID || MasterSecret,
  salt='truxify-wallet-key-derivation',
  iterations=100,000,
  length=32
)
```

**Storage:**
```
EncryptedData = {
  iv: random(12),
  encryptedKey: AES-256-GCM(privateKey),
  authTag: GCM-authTag,
  salt: random(32),
  algorithm: 'aes-256-gcm',
  timestamp: ISO8601
}
```

**API:**
```javascript
// Encrypt private key
const encrypted = await keyManagement.encryptPrivateKey(
  privateKey,
  deviceId,
  masterSecret
);

// Decrypt private key
const decrypted = await keyManagement.decryptPrivateKey(
  encryptedData,
  deviceId,
  masterSecret
);

// Store encrypted key
const keyId = await keyManagement.storeEncryptedKey(
  userId,
  walletAddress,
  encryptedData,
  deviceId
);

// Retrieve encrypted key
const key = await keyManagement.retrieveEncryptedKey(
  userId,
  walletAddress
);

// Archive key (on rotation)
await keyManagement.archiveKey(keyId, 'routine_rotation');
```

### 2. Key Rotation Service (keyRotationService.js)

**Rotation Process:**
1. Validate both current and new private keys
2. Create rotation audit record
3. Archive current key with reason
4. Encrypt and store new key
5. Transfer ownership on-chain (optional)
6. Complete rotation and log event

**Policy-Driven Rotation:**
- Enforce 90-day rotation policy
- Track rotation history per wallet
- Block operations if rotation overdue

**Blockchain Integration:**
- Transfers key ownership on-chain
- Verifies new key ownership
- Archives transaction hash for audit

**API:**
```javascript
// Initiate key rotation
const result = await keyRotation.initiateKeyRotation(
  userId,
  walletAddress,
  currentPrivateKey,
  newPrivateKey,
  'security_breach' // reason: 'routine', 'security_breach', 'device_compromise'
);

// Get rotation history
const history = await keyRotation.getRotationHistory(
  userId,
  walletAddress,
  limit=10
);

// Check rotation policy
const policy = await keyRotation.enforceKeyRotationPolicy(
  userId,
  daysSinceLastRotation=90
);

// Transfer ownership on-chain
const tx = await keyRotation.transferKeyOwnershipOnChain(
  userId,
  walletAddress,
  oldPrivateKey,
  newPrivateKey
);
```

### 3. Anomaly Detection Service (anomalyDetectionService.js)

**Detected Anomalies:**

1. **Large Withdrawal** (HIGH severity)
   - Amount > 3σ above average
   - Blocks transaction if suspicious
   - Examples: Sudden withdrawal of 5 MATIC when average is 0.5 MATIC

2. **Unusual Time** (LOW severity)
   - Transfers between 00:00-06:00 UTC
   - Non-blocking alert only

3. **Multiple Transfers** (MEDIUM severity)
   - 5+ transfers in 10-minute window
   - Indicates possible compromise
   - May trigger account lock

4. **Unusual Destination** (MEDIUM severity)
   - First transfer to new wallet address
   - Indicates possible compromise
   - Requires verification

**Response Actions:**
- LOW severity: Log alert
- MEDIUM severity: Alert + log + optionally lock
- HIGH/CRITICAL severity: Block + alert + lock + key rotation suggestion

**API:**
```javascript
// Analyze transaction for anomalies
const analysis = await anomalyDetection.analyzeTransaction(
  userId,
  walletAddress,
  {
    amount: 1.5,
    toAddress: '0x...',
    timestamp: new Date().toISOString(),
  }
);

// Response includes:
// {
//   detectedAnomalies: [],
//   riskLevel: 'LOW|MEDIUM|HIGH|CRITICAL',
//   shouldBlock: true|false
// }

// Lock account for 24 hours
await anomalyDetection.lockAccount(
  userId,
  walletAddress,
  'multiple_anomalies_detected',
  anomalies
);

// Unlock account after investigation
await anomalyDetection.unlockAccount(userId, walletAddress);
```

## Database Schema

### encrypted_wallet_keys
```sql
CREATE TABLE encrypted_wallet_keys (
  key_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  encrypted_key JSONB NOT NULL,     -- Contains: iv, encryptedKey, authTag, salt, algorithm
  device_id VARCHAR(255),
  version INT DEFAULT 1,             -- Key version for tracking
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP,
  last_used_at TIMESTAMP,
  archived_at TIMESTAMP,
  archive_reason VARCHAR(255)
);

CREATE INDEX idx_encrypted_keys_user_wallet ON encrypted_wallet_keys(user_id, wallet_address);
CREATE INDEX idx_encrypted_keys_active ON encrypted_wallet_keys(active);
```

### key_rotations
```sql
CREATE TABLE key_rotations (
  rotation_id VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  reason VARCHAR(100),              -- 'routine', 'security_breach', 'device_compromise'
  status VARCHAR(50),                -- 'in_progress', 'completed', 'failed'
  new_key_id UUID,
  initiated_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_rotations_user_wallet ON key_rotations(user_id, wallet_address);
CREATE INDEX idx_rotations_initiated_at ON key_rotations(initiated_at);
```

### key_ownership_transfers
```sql
CREATE TABLE key_ownership_transfers (
  id UUID PRIMARY KEY,
  old_key VARCHAR(20),              -- First 10 chars of old key (masked)
  new_key VARCHAR(20),              -- First 10 chars of new key (masked)
  wallet_address VARCHAR(255),
  tx_hash VARCHAR(255),
  block_number INT,
  completed_at TIMESTAMP
);
```

### anomaly_log
```sql
CREATE TABLE anomaly_log (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  wallet_address VARCHAR(255),
  anomalies JSONB,                 -- Array of detected anomalies
  risk_level VARCHAR(50),           -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  detected_at TIMESTAMP
);

CREATE INDEX idx_anomaly_log_user_wallet ON anomaly_log(user_id, wallet_address);
CREATE INDEX idx_anomaly_log_risk_level ON anomaly_log(risk_level);
```

### wallet_locks
```sql
CREATE TABLE wallet_locks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  wallet_address VARCHAR(255),
  reason VARCHAR(255),              -- Reason for lock
  anomalies JSONB,                 -- Anomalies that triggered lock
  locked_at TIMESTAMP,
  locked_until TIMESTAMP,
  unlocked_at TIMESTAMP
);

CREATE INDEX idx_wallet_locks_user_wallet ON wallet_locks(user_id, wallet_address);
CREATE INDEX idx_wallet_locks_active ON wallet_locks(locked_at, unlocked_at);
```

## Integration Example

### Initialize Services
```javascript
import KeyManagementService from './services/security/keyManagementService.js';
import KeyRotationService from './services/security/keyRotationService.js';
import AnomalyDetectionService from './services/security/anomalyDetectionService.js';

const keyManagement = new KeyManagementService();
const keyRotation = new KeyRotationService({ keyManagementService: keyManagement });
const anomalyDetection = new AnomalyDetectionService({ keyRotationService: keyRotation });
```

### Store New Wallet Key
```javascript
// Generate master secret (send to client securely)
const masterSecret = keyManagement.generateMasterSecret();

// Client sends back encrypted key
const encryptedData = {
  iv: '...',
  encryptedKey: '...',
  authTag: '...',
  salt: '...',
};

// Store encrypted key
const keyId = await keyManagement.storeEncryptedKey(
  userId,
  walletAddress,
  encryptedData,
  'ios-device-123'
);
```

### Rotate Key on Compromise
```javascript
try {
  const result = await keyRotation.initiateKeyRotation(
    userId,
    walletAddress,
    currentPrivateKey,
    newPrivateKey,
    'security_breach'
  );
  
  if (result.status === 'success') {
    // Optionally transfer ownership on-chain
    await keyRotation.transferKeyOwnershipOnChain(
      userId,
      walletAddress,
      currentPrivateKey,
      newPrivateKey
    );
  }
} catch (err) {
  logger.error('Key rotation failed:', err.message);
}
```

### Monitor Transactions
```javascript
// Before allowing transaction
const analysis = await anomalyDetection.analyzeTransaction(
  userId,
  walletAddress,
  {
    amount: transferAmount,
    toAddress: recipientWallet,
    timestamp: new Date().toISOString(),
  }
);

if (analysis.shouldBlock) {
  return res.status(403).json({
    error: 'Transaction blocked due to security concerns',
    reason: analysis.detectedAnomalies,
    requiresVerification: true,
  });
}

// Allow transaction
```

## Environment Variables

```env
# Key Management
ENCRYPTION_ALGORITHM=aes-256-gcm
PBKDF2_ITERATIONS=100000
SERVER_DEVICE_ID=server-backend

# Key Rotation Policy
KEY_ROTATION_DAYS=90
MAX_FAILED_ROTATIONS=3

# Anomaly Detection
ANOMALY_LARGE_WITHDRAWAL_THRESHOLD=1000
ANOMALY_MULTIPLE_TRANSFERS_LIMIT=5
ANOMALY_LOCK_DURATION_HOURS=24

# Alerts
SECURITY_ALERT_EMAIL=security@truxify.io
ANOMALY_ALERT_SLACK_CHANNEL=#security-alerts
```

## Security Best Practices

### Key Management
1. ✅ Never log private keys
2. ✅ Clear master secrets from memory after use
3. ✅ Use secure random for all cryptographic operations
4. ✅ Validate private keys before encryption
5. ✅ Rotate encryption keys every 90 days

### Storage
1. ✅ Always encrypt keys at rest
2. ✅ Use device-specific encryption keys
3. ✅ Archive old keys with audit trail
4. ✅ Never transmit keys in plaintext
5. ✅ Use TLS for all network communication

### Rotation
1. ✅ Require multi-step verification for rotation
2. ✅ Log all rotation attempts (success and failure)
3. ✅ Notify user of key rotations
4. ✅ Keep old keys for transaction verification
5. ✅ Transfer ownership on-chain when possible

### Monitoring
1. ✅ Alert on anomalous transactions
2. ✅ Lock accounts for manual review if suspicious
3. ✅ Track all key access (audit log)
4. ✅ Monitor for brute force attempts
5. ✅ Regular security reviews of rotation history

## Compliance

- ✅ OWASP A02:2021 - Cryptographic Failures
- ✅ OWASP A05:2021 - Access Control
- ✅ FIPS 140-2 - Cryptography Standards
- ✅ NIST SP 800-38D - GCM Mode
- ✅ NIST SP 800-132 - PBKDF2

## Testing

### Unit Tests
```javascript
describe('KeyManagementService', () => {
  test('encrypts and decrypts keys correctly', async () => {
    const original = '0x' + '1'.repeat(64);
    const encrypted = await keyManagement.encryptPrivateKey(original, 'test-device', 'secret');
    const decrypted = await keyManagement.decryptPrivateKey(encrypted, 'test-device', 'secret');
    expect(decrypted).toBe(original);
  });

  test('rejects invalid private keys', () => {
    expect(keyManagement.validatePrivateKey('invalid')).toBe(false);
    expect(keyManagement.validatePrivateKey('0x' + '1'.repeat(63))).toBe(false);
  });
});

describe('AnomalyDetectionService', () => {
  test('detects large withdrawals', async () => {
    const result = await anomalyDetection.analyzeTransaction(
      userId,
      wallet,
      { amount: 100, timestamp: new Date().toISOString() }
    );
    expect(result.detectedAnomalies.some(a => a.type === 'LARGE_WITHDRAWAL')).toBe(true);
  });
});
```

## Incident Response

### If Key Compromised
1. Immediately invoke key rotation
2. Lock wallet for manual review
3. Alert user via email/SMS
4. Cancel any pending transactions
5. Archive compromised key with 'security_breach' reason
6. Monitor for unauthorized transactions

### If Account Locked
1. Notify user with reason and evidence
2. Allow 2FA verification to unlock
3. Require transaction review
4. Consider mandatory key rotation
5. Track unlock reason for audit

## References

- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [FIPS 140-2 Cryptographic Module Validation](https://csrc.nist.gov/projects/cryptographic-module-validation-program/)
- [NIST SP 800-38D - GCM Mode](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)
- [Node.js Crypto Documentation](https://nodejs.org/api/crypto.html)
- [ethers.js Wallet Documentation](https://docs.ethers.org/v6/api/wallet/)
