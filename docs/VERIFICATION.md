# Verification Services

## Overview

The Truxify backend verifies driver identity and documents through multiple channels: KYC document checks, DigiLocker, and zero-knowledge proof verification on-chain.

---

## Location

```
backend/api/src/services/verification/VerificationService.js — document verification
backend/api/src/services/digilockerService.js                — DigiLocker OAuth + sync
backend/api/src/services/zkp/zkp.service.js                  — ZK-SNARK KYC verification
backend/api/src/routes/verificationRoutes.js                 — HTTP surface
```

---

## Document Verification

`VerificationService.verifyDocument`:

- Confirms the document record exists and belongs to the driver.
- Runs content validation (`lib/documentValidation.js` — magic bytes) and the malware scanner.
- Marks the document verified/approved on success; rejection records a reason.

## DigiLocker

- `exchangeCode` swaps the OAuth code for a token.
- `verifyAndSyncDocuments` fetches issued documents (or mock documents in `DIGILOCKER_MOCK` mode), registers hashes on-chain when a contract is configured, uploads blobs to storage, and upserts `driver_documents` rows.
- Mock mode is **refused in production** (`NODE_ENV=production`), so fabricated proofs can never be recorded as genuine.

## ZKP Verification

`zkpService.verifyDriver`:

- Builds a document hash, generates a ZK-SNARK proof (mock in test mode; a real circuit worker otherwise).
- Submits the proof on-chain (`verifyKYC`), guarded by a per-user Redis lock.
- Holds a distributed lock for the whole flow; `LockAcquisitionError` → 503, in-flight duplicates → 409.
- Server-side verification gate (`KYC_NOT_SERVER_VERIFIED`) prevents unverified approvals.

---

## Why It Exists

Driver KYC is the trust foundation for payments and escrow. Layered verification (documents + government sources + on-chain proofs) makes it hard to forge, and the on-chain component makes verification portable and auditable.

---

## Testing

Automated tests verify:

- Document verification and rejection paths.
- DigiLocker mock-mode guards and sync.
- ZKP proof generation, lock handling, and production mock guard.
