# Notification Types Reference

## Overview
The Truxify notification system supports multiple notification types, each with specific delivery channels (FCM push, email, in-app) and priority levels.

**Issue #8494 Context**: The notification service enforces a strict allowlist that MUST match the database CHECK constraint in `supabase/migrations/20260807000050_widen_notifications_notif_type_check.sql`.

## Allowlist (Single Source of Truth)

The canonical list lives in `backend/api/src/lib/notifTypeAllowlist.js`:

```javascript
export const ALLOWED_NOTIF_TYPES = new Set([
  'order_update',
  'payment',
  'load_offer',
  'trip_update',
  'document',
  'system',
  'bid_accepted',
  'new_bid',
  'payment_locked',
  'payment_released',
]);
```

## Type Definitions

### order_update
- **Trigger**: Order status changes (e.g., `pending` → `accepted`)
- **Channels**: FCM + In-app
- **Priority**: Normal
- **Recipients**: Customer + Driver

### payment
- **Trigger**: Payment processed (escrow funded, released, or refunded)
- **Channels**: FCM + Email + In-app
- **Priority**: High
- **Recipients**: Customer + Driver

### load_offer
- **Trigger**: New load offered to driver or customer receives bids
- **Channels**: FCM + In-app
- **Priority**: Normal
- **Recipients**: Driver (new offer) or Customer (new bids)

### trip_update
- **Trigger**: Trip milestone reached (pickup, in-transit, delivered)
- **Channels**: FCM + In-app
- **Priority**: Normal
- **Recipients**: Customer + Driver

### document
- **Trigger**: Document uploaded/verified (KYC, POD, insurance)
- **Channels**: Email + In-app
- **Priority**: Low
- **Recipients**: User who uploaded + Admin

### system
- **Trigger**: System-wide announcements, maintenance, policy updates
- **Channels**: FCM + Email + In-app
- **Priority**: Normal
- **Recipients**: All users (or role-filtered)

### bid_accepted
- **Trigger**: Driver's bid on a load is accepted by customer
- **Channels**: FCM + In-app
- **Priority**: High
- **Recipients**: Driver

### new_bid
- **Trigger**: New bid placed on customer's load
- **Channels**: FCM + In-app
- **Priority**: High
- **Recipients**: Customer

### payment_locked
- **Trigger**: Customer's escrow deposit locked (funds reserved)
- **Channels**: FCM + Email + In-app
- **Priority**: High
- **Recipients**: Customer

### payment_released
- **Trigger**: Escrow released to driver (trip completed)
- **Channels**: FCM + Email + In-app
- **Priority**: High
- **Recipients**: Driver

## Database Constraint

The `notifications` table enforces this allowlist via a CHECK constraint:

```sql
ALTER TABLE notifications ADD CONSTRAINT notifications_notif_type_check
CHECK (notif_type IN (
  'order_update','payment','load_offer','trip_update','document','system',
  'bid_accepted','new_bid','payment_locked','payment_released'
));
```

**Important**: Any attempt to insert a notif_type not in this list will fail with a PostgreSQL constraint violation error.

## Adding New Notification Types

To add a new notification type:

1. **Update the database migration**: Add the new type to the CHECK constraint
2. **Update `notifTypeAllowlist.js`**: Add to `ALLOWED_NOTIF_TYPES`
3. **Optionally add to `FCM_ENABLED_TYPES`**: If push notification needed
4. **Optionally add to `HIGH_PRIORITY_TYPES`**: If urgent delivery required
5. **Update this documentation**: Describe the trigger and recipients
6. **Add tests**: Verify the new type is accepted by validation

## Usage in Code

```javascript
import { validateNotifType, shouldPushFCM, isHighPriority } from '../lib/notifTypeAllowlist.js';

// Validate before inserting
const validation = validateNotifType('payment_released');
if (!validation.valid) {
  throw new Error(validation.error);
}

// Check if FCM push needed
if (shouldPushFCM(validation.normalized)) {
  await sendPushNotification(userId, title, body, {
    priority: isHighPriority(validation.normalized) ? 'high' : 'normal'
  });
}
```

## Testing

The allowlist is tested in `backend/api/test/unit/notificationService.test.js`:

```bash
npm run test:unit -- backend/api/test/unit/notificationService.test.js
```

## Related Issues
- #8494 - notificationService.js module restoration
- #7538 - Original notif_type rejection bug
