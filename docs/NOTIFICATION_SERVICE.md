# Notification Service

## Overview

The Truxify backend sends push notifications through Firebase Cloud Messaging and persists notification rows, with retries, token invalidation, and delivery-OTP support (`services/notificationService.js`).

---

## Location

```
backend/api/src/services/notificationService.js
```

---

## Push Delivery

`sendFcmNotification(userId, notification, data)`:

- Reads the user's FCM token from `profiles`.
- Serializes data payload values (objects become JSON strings).
- Retries up to 3 times with exponential backoff for transient errors (`messaging/unavailable`, `messaging/internal-error`, ...).
- Detects invalid/expired tokens and clears them so stale tokens are not retried forever.
- Returns `{ success, messageId }` or `{ success: false, error, errorCode }`.

`sendPushNotification` persists a `notifications` row (best-effort) and then attempts the push.

---

## Delivery OTPs

- `storeDeliveryOtp` stores a salted scrypt hash of the OTP with an expiry.
- `getActiveDeliveryOtp` reads the latest unverified, unexpired OTP.
- `verifyDeliveryOtp` consumes a specific OTP record by ID (never bulk-updates).
- `expireDeliveryOtps` invalidates outstanding OTPs for an order.
- OTPs are never persisted in plaintext, and notification metadata never carries an OTP or a derived digest.

---

## Why It Exists

Delivery verification depends on push delivery being reliable and OTP handling being brute-force-resistant. Retries + token cleanup keep pushes working, and salted hashes keep OTPs safe even if the table leaks.

---

## Testing

Automated tests verify:

- FCM success, retry, and invalid-token paths.
- Notification persistence.
- OTP store/verify/expire flows.
- Metadata never contains plaintext OTPs.
