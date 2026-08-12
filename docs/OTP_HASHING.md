# OTP Hashing

## Overview

The Truxify backend hashes one-time passwords (OTPs) with scrypt and a per-OTP random salt so stored digests cannot be brute-forced offline. The helper (`lib/otpHashing.js`) is used for delivery verification OTPs and login OTPs.

---

## Location

```
backend/api/src/lib/otpHashing.js
```

---

## How It Works

### hashOtp(otp, saltHex?)

- Generates a fresh 16-byte random salt when none is supplied.
- Derives a 64-byte scrypt key from the OTP and salt.
- Returns `{ hash, salt }` as hex strings.

### verifyOtpHash(otp, otpRecord)

- When the record carries `otp_salt`, re-derives the scrypt key and compares with `crypto.timingSafeEqual`.
- For pre-migration records without a salt, falls back to a SHA-256 comparison so in-flight OTPs keep working for their TTL window.
- Returns `false` for malformed stored hashes.

---

## Why It Exists

An unsalted SHA-256 of a 6-digit code can be brute-forced in seconds offline (only 10^6 candidates). Salted scrypt makes offline cracking expensive, and `timingSafeEqual` prevents timing attacks that could leak whether the prefix of a guess matches.

---

## Security Notes

- Verification is constant-time.
- Invalid stored-hash formats are rejected rather than compared.
- The salt is stored alongside the digest, so verification can reproduce the derivation.

---

## Testing

Automated tests verify:

- Hash generation produces a 128-char hex digest and a salt.
- Correct and incorrect OTPs verify correctly.
- Salted and legacy (SHA-256) records verify.
- Malformed records are rejected.
