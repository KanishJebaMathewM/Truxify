# Phone Number OTP Verification Flow

## Overview
The phone OTP flow enables passwordless authentication and phone number verification for Truxify users. This document describes the complete flow, including the OTP producer that was missing and causing `POST /api/auth/verify-otp` to always fail with "OTP not found or has expired" (Issue #10471).

## Flow Diagram

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Client App │         │  API Server │         │   Database  │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │ POST /request-otp     │                       │
       │ {phone: "+91..."}     │                       │
       ├──────────────────────►│                       │
       │                       │  Check rate limit     │
       │                       ├──────────────────────►│
       │                       │                       │
       │                       │  Generate OTP + salt  │
       │                       │  Hash OTP (SHA-256)   │
       │                       │                       │
       │                       │  INSERT phone_otps    │
       │                       ├──────────────────────►│
       │                       │                       │
       │  {otpId, expiresAt}   │                       │
       │◄──────────────────────┤                       │
       │                       │                       │
       │  [SMS delivered via   │                       │
       │   notification svc]   │                       │
       │◄──────────────────────┤                       │
       │                       │                       │
       │ POST /verify-otp      │                       │
       │ {phone, otp}          │                       │
       ├──────────────────────►│                       │
       │                       │  SELECT latest OTP    │
       │                       ├──────────────────────►│
       │                       │                       │
       │                       │  Hash provided OTP    │
       │                       │  Compare with stored  │
       │                       │                       │
       │                       │  UPDATE verified=true │
       │                       ├──────────────────────►│
       │                       │                       │
       │  {success, token}     │                       │
       │◄──────────────────────┤                       │
```

## Security Properties

### 1. Plaintext OTPs Never Stored
- OTPs are hashed with a per-request salt using SHA-256
- Even a database breach does not expose valid OTPs
- The hash is timing-safe compared to prevent timing attacks

### 2. Rate Limiting
- **Per-phone rate limit**: Max 3 OTPs per 60-minute window
- **Per-IP rate limit**: Enforced by Express rate limiter middleware
- **Attempt lockout**: After 5 failed verification attempts, the OTP is locked

### 3. Expiration
- OTPs expire after 10 minutes (configurable)
- Expired OTPs cannot be verified
- Background worker cleans up expired records after 30 days

### 4. Single-Use
- Once verified, an OTP cannot be reused
- Requesting a new OTP invalidates all previous unverified OTPs for that phone

## Endpoints

### POST /api/auth/request-otp
**Producer endpoint** - generates and stores the OTP.

**Request:**
```json
{
  "phone": "+919999999999",
  "channel": "sms",
  "purpose": "verify_phone"
}
```

**Response (200):**
```json
{
  "success": true,
  "otpId": "uuid-...",
  "expiresAt": "2026-09-17T13:00:00Z",
  "ttlMinutes": 10
}
```

**Error Responses:**
- `400 INVALID_PHONE_FORMAT` - Phone not in E.164 format
- `429 RATE_LIMIT_EXCEEDED` - Too many requests (includes `retryAfter`)
- `503 SERVICE_UNAVAILABLE` - DB/OTP service not configured

### POST /api/auth/verify-otp
**Consumer endpoint** - verifies the OTP and issues a session token.

**Request:**
```json
{
  "phone": "+919999999999",
  "otp": "123456"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJ...",
  "user": { "id": "...", "phone": "+91..." }
}
```

## Implementation Details

### OTP Generation
```javascript
const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
// Examples: "000042", "999999", "123456"
```
- Uses `crypto.randomInt` for cryptographic security
- Zero-padded to guarantee 6 digits

### Hashing
```javascript
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.createHash('sha256').update(otp + salt).digest('hex');
```
- 16-byte random salt per OTP
- SHA-256 hash of `otp + salt`
- Stored as `otp_hash` and `otp_salt` in `phone_otps`

### Verification
```javascript
const computed = hashOtp(providedOtp, storedSalt);
const valid = crypto.timingSafeEqual(
  Buffer.from(computed, 'hex'),
  Buffer.from(storedHash, 'hex')
);
```
- Recomputes hash with stored salt
- Timing-safe comparison to prevent side-channel attacks

## Database Schema

```sql
CREATE TABLE phone_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  otp_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  channel TEXT DEFAULT 'sms',
  purpose TEXT DEFAULT 'verify_phone',
  attempts INTEGER DEFAULT 0,
  invalidated_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_phone_otps_phone ON phone_otps(phone);
CREATE INDEX idx_phone_otps_expires ON phone_otps(expires_at);
```

## Testing

### Without Pre-Seeding (Critical Regression Test)
The key test verifies the producer flow WITHOUT pre-inserting OTP rows:

```javascript
it('should allow verify-otp to succeed after request-otp', async () => {
  // No pre-seeding - the producer must create the row
  const res1 = await request(app)
    .post('/api/auth/request-otp')
    .send({ phone: '+919999999999' });
  expect(res1.status).toBe(200);

  // Verify row exists in phone_otps
  const { data } = await supabaseAdmin
    .from('phone_otps')
    .select('*')
    .eq('phone', '+919999999999');
  expect(data.length).toBeGreaterThan(0);
});
```

## Client Integration Guide

### Flutter (Customer/Driver Apps)
```dart
// Request OTP
final response = await http.post(
  Uri.parse('$baseUrl/api/auth/request-otp'),
  body: jsonEncode({'phone': '+91$userPhone'}),
);

if (response.statusCode == 200) {
  // Show OTP input screen
  // User enters OTP received via SMS
  final verifyRes = await http.post(
    Uri.parse('$baseUrl/api/auth/verify-otp'),
    body: jsonEncode({'phone': '+91$userPhone', 'otp': userEnteredOtp}),
  );
}
```

### Rate Limit Handling
Clients should handle 429 responses gracefully:
```dart
if (response.statusCode == 429) {
  final retryAfter = jsonDecode(response.body)['retryAfter'];
  showSnackbar('Please wait ${retryAfter}s before requesting another OTP');
}
```

## Monitoring

Track these metrics:
- OTP request success rate
- OTP verification success rate
- Average time between request and verification
- Rate limit hits
- Failed verification attempts (potential brute force)

## Related Issues
- #10471 - OTP producer missing (this fix)
- #9489 - phone_otps table creation
- #9243 - Original OTP verification bug

