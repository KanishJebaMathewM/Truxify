# Key Management Service

## Overview

The Truxify backend manages encryption keys for sensitive wallet data (`services/security/keyManagementService.js`), including key rotation with history tracking.

---

## Location

```
backend/api/src/services/security/keyManagementService.js
backend/api/src/services/security/keyRotationService.js
```

---

## Behavior

- **Key storage** — encryption keys are persisted (encrypted wallet keys per user) and never returned in plaintext.
- **Rotation** — `keyRotationService` rotates active keys on a schedule, caches active keys in memory to minimize KMS lookups, and records rotation history so older ciphertexts can still be decrypted with their original key version.
- **Versioning** — each ciphertext is tagged with the key version used, so decryption selects the right key even after rotation.

---

## Why It Exists

Wallet private keys are the highest-value secret in the system. Key rotation bounds the damage of a leaked key: even if one version is compromised, rotated data uses a new key, and history lets the system migrate gradually instead of forcing a one-shot re-encryption.

---

## Testing

Automated tests verify:

- Key storage and retrieval.
- Rotation history tracking.
- Version-tagged encryption/decryption.
- In-memory key caching.
