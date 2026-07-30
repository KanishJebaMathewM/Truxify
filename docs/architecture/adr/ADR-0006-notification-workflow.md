# ADR-0006: Notification Workflow — OTP-Based Delivery Verification

## Status

Accepted

## Context

Delivery verification is a critical operation in the order lifecycle. When a driver claims to have delivered goods, the system must verify that:

1. The customer (receiver) acknowledges the delivery.
2. The correct goods were delivered to the correct location.
3. The delivery proof cannot be repudiated later.

Truxify uses a time-based one-time password (OTP) system for this verification:

- When the driver reaches "In Transit" milestone, the system generates a 6-digit OTP and sends it to the customer via Firebase Cloud Messaging (FCM).
- When the driver arrives at the delivery location and selects "Arriving" milestone, they can enter the OTP shared by the customer.
- The system verifies the OTP, releases escrow payment to the driver, and marks the order as delivered.

The initial implementation scattered OTP generation, storage, verification, lockout, and notification logic across multiple files with duplicated helper functions and inconsistent fallback behaviour.

## Decision

Consolidate notification and OTP logic into `OrderNotificationService` while keeping delivery verification (which includes escrow release) in `DeliveryVerificationService`.

### Responsibility Boundaries

| Concern | Owner | Location |
| ------- | ----- | -------- |
| OTP generation (6-digit, cryptographically random) | Shared util | `deliveryVerificationService.js` |
| OTP storage (hash + expiry in `delivery_otps` table) | `orderRepository` | `orderRepository.js` |
| OTP dispatch (FCM push notification) | `orderNotificationService` | `orderNotificationService.js` |
| OTP verification (timing-safe hash comparison) | `deliveryVerificationService` | `deliveryVerificationService.js` |
| Failed attempt tracking + lockout | Shared helper | `deliveryVerificationService.js` |
| Escrow release on successful verification | `escrow` service | `escrow.js` |
| Post-verification state mutation (RPC `complete_trip_tx`) | `deliveryVerificationService` | `deliveryVerificationService.js` |

### OTP Flow

```text
1. Driver marks "In Transit" milestone
        │
        ▼
2. Generate 6-digit OTP (crypto.randomInt)
        │
        ▼
3. Store OTP hash + expiry in delivery_otps table
   (SHA-256 hash, 15-minute TTL)
        │
        ▼
4. Send OTP to customer via FCM push notification
   (failure is non-fatal — customer can request resend)
        │
        ▼
5. Driver arrives, selects "Arriving", enters OTP
        │
        ▼
6. Verify OTP (timing-safe SHA-256 comparison)
        │
        ▼
7. On failure → increment counter, lockout after 5 attempts
   On success → release escrow, execute complete_trip_tx RPC
```

### Lockout Strategy

OTP brute-force prevention uses a tiered approach:

```text
┌──────────────────────────────────────────────────────────────┐
│  1st failed attempt → counter=1                             │
│  2nd failed attempt → counter=2                             │
│  3rd failed attempt → counter=3                             │
│  4th failed attempt → counter=4                             │
│  5th failed attempt → LOCKOUT (30 minutes)                  │
│                        All subsequent attempts → 429        │
│                        (until lockout expires or OTP reset) │
└──────────────────────────────────────────────────────────────┘
```

- **Primary store**: Redis (atomic INCR + EXPIRE, distributed across instances)
- **Fallback store**: In-memory `Map` with LRU eviction (max 10,000 entries)
- **Lockout reset**: On successful OTP verification or OTP regeneration ("In Transit" re-trigger)

### Escrow Release + RPC

After OTP verification, two critical operations happen:

1. **Blockchain escrow release**: Call `escrowRelease()` which submits a `releasePayment` transaction to the Polygon smart contract. The system waits for on-chain confirmation.
2. **Database state mutation**: Execute `complete_trip_tx` RPC in a single database transaction, which updates the order, OTP, trips, wallet, and earnings atomically.

These two operations cannot be in the same database transaction (one is on-chain, one is in PostgreSQL). The system:

- Releases escrow first (the risky operation).
- Executes the RPC second (fast, atomic).
- Verifies post-RPC state with a `findOrderById` to confirm `status === 'payment_released'`.
- If the escrow release fails but the RPC succeeded (or vice versa), reconciliation services handle the inconsistency.

### Notification Failure Handling

FCM push notifications can fail (device offline, token expired, service unavailable). The system:

- **Does not block the operation**: The driver's milestone update succeeds even if the customer does not receive the push notification.
- **Flags the failure**: Sets `notification_failed: true` on the order for diagnostic purposes.
- **Provides resend capability**: The driver can request a resend via `POST /orders/:id/resend-otp`, which generates a fresh OTP, replaces the previous one, and sends a new notification.

## Consequences

### Positive

- OTP verification uses a timing-safe comparison (`crypto.timingSafeEqual`), preventing timing side-channel attacks against the hash comparison.
- The lockout mechanism prevents brute-force attacks while allowing recovery (via resend or timeout).
- Redis fallback to in-memory Map ensures the system remains functional during Redis outages.
- The two-phase release (blockchain first, RPC second) ensures that the escrow release is the authoritative operation; if it succeeds but the RPC fails, reconciliation can recover the database state.
- Post-RPC verification prevents silent state corruption.

### Trade-offs

- The two-phase release has a gap: if the blockchain release succeeds but the RPC fails, the driver is paid but the order status says `'arriving'`. The `escrowReleaseReconciliation` cron job handles this by detecting released orders that were not completed.
- OTP hash storage uses SHA-256, which is fast and suitable for TTL-limited OTPs but would not be appropriate for long-term password storage (bcrypt/argon2 would be preferable for passwords).
- The notification helper functions (`checkOtpLockout`, `recordOtpFailure`, `clearOtpState`) are duplicated across `deliveryVerificationService.js`, `orderMilestoneService.js`, and `orderNotificationService.js`. This is technical debt — these should be consolidated into a single shared module.
- In-memory OTP tracking is not shared across server instances. Under horizontal scaling, failed attempts and lockout state would be per-instance unless Redis is available.

### Future Considerations

- Consolidate the duplicated OTP helper functions (`checkOtpLockout`, `recordOtpFailure`, `clearOtpState`) into a single module (`src/services/otp.js` or similar) to eliminate the current three-way duplication.
- Consider moving OTP hash storage to use HMAC with a server-side secret for additional protection against database leaks.
- The current 15-minute OTP TTL and 30-minute lockout are hardcoded defaults via environment variables (`OTP_TTL_MINUTES`, `OTP_LOCKOUT_MINUTES`). These could be made configurable per-order-type in the future.
- FCM delivery receipts could be used to detect and retry failed notifications automatically rather than relying on the driver to request a resend.

## Alternatives Considered

### No OTP — driver marks delivered directly

Rejected because it provides no proof that the customer received the goods. A dishonest driver could mark an order as delivered without actually delivering it.

### Biometric verification

Rejected because it requires specialised hardware (fingerprint scanner, face recognition) not available on all devices in the target market (budget Android phones).

### QR code scanning

Rejected because it requires the customer to have the app open and the driver to show a QR code on their phone, adding friction. OTP is a familiar pattern (used by payments, delivery apps, and SMS-based authentication) and works on any phone.

### SMS-based OTP via Twilio

The codebase includes a stub for Twilio SMS, but it is not wired up. FCM push notifications are preferred because they are free (vs. SMS costs), deliver instantly over data, and do not require the customer to have a specific SIM card. SMS would be a fallback for customers who do not have the app installed or have notifications disabled.

### Always require blockchain escrow

Some orders may not have a funded escrow (e.g., if the blockchain integration fails or the customer pays via another method). The verification system handles both cases — if escrow is not funded, it skips the blockchain release and proceeds directly to the RPC.
