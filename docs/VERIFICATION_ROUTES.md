# Verification Routes

Endpoints for order delivery verification, KYC document checks, DigiLocker
integration, and KYC uploads.

## GET /api/verification/order/:orderId

Runs a full verification of an order (oracle consensus, cross-chain hash,
document integrity, driver status).

## POST /api/verification/documents/check

Body: `{ driverId }`. Returns the document integrity status for the driver.
An IDOR guard (`document:view` policy) limits callers to their own documents
unless they hold an admin role.

## POST /api/verification/digilocker/token

Body: `{ code }`. Exchanges a DigiLocker OAuth code for an access token.

## POST /api/verification/digilocker/verify

Body: `{ accessToken, userId? }`. Verifies documents via DigiLocker.

## POST /api/verification/kyc/upload

Multipart `image` upload (JPEG/PNG, max 10MB). The buffer is magic-byte
validated and malware-scanned before OCR forwarding. Sets the driver KYC
status to `Pending KYC`, `Verified`, or `Rejected`.

### Rate limiting

Each endpoint is limited to 300 requests / 15 minutes per IP.

### Errors

| Status | Meaning                          |
| ------ | -------------------------------- |
| 422    | Invalid document / malware hit.  |
| 503    | ML OCR service unconfigured.     |
