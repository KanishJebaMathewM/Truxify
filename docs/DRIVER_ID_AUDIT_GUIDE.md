# Driver ID Identity Resolution - Audit & Migration Guide

## Overview
This guide documents the security audit and migration for ensuring all driver identity resolution uses Supabase auth sessions, not compile-time constants.

## Issue #1011: Compile-Time Driver ID Vulnerability

### Problem
The app may have residual usage of compile-time `DRIVER_ID` constants in non-core code paths (UI components, analytics, notification handlers), creating hardcoded credential risks.

### Solution
All driver identity decisions must come from the Supabase auth session (`Supabase.instance.client.auth.currentUser?.id`), never from compile-time constants.

## Usage Patterns

### ✅ CORRECT: Use Supabase Auth Session
```dart
// Direct access to auth session
final driverId = Supabase.instance.client.auth.currentUser?.id ?? '';

// Or use the helper with auth validation
final driverId = DriverSession.driverId;
if (driverId.isEmpty) {
  // Handle unauthenticated case
}
```

### ❌ WRONG: Use Compile-Time Constants
```dart
const DRIVER_ID = 'hardcoded-value'; // NEVER use this in production
```

## Audit Checklist

When adding new code that needs a driver ID, verify:

- [ ] Identity comes from `Supabase.instance.client.auth.currentUser`
- [ ] Fallback to compile-time constant only in tests/dev-only features
- [ ] No hard-coded driver IDs in config files
- [ ] Analytics events use auth session, not environment variables
- [ ] Notifications are sent to session-authenticated drivers
- [ ] Location tracking is tied to auth session, not constants
- [ ] Unit tests mock auth session, not env constants

## Files Modified in PR #1011

1. **apps/driver/lib/core/driver_session.dart**
   - Added comprehensive documentation
   - Added `isAuthenticated` helper
   - Added `isDevOverride` helper for dev-only checks
   - Clarified compile-time override is dev-only

2. **apps/driver/test/driver_session_test.dart** (NEW)
   - Tests verify auth session is the identity source
   - Tests ensure compile-time constants don't interfere
   - Documents expected behavior for production

3. **docs/DRIVER_ID_AUDIT_GUIDE.md** (NEW)
   - This document
   - Usage patterns and examples
   - Audit checklist for new code

## Implementation Notes

### Dev-Only Compile-Time Override
For local development without Supabase auth, the app supports:
```bash
flutter run --dart-define=DRIVER_ID=dev-driver-uuid
```

This is **strictly for development** and will be ignored when a real auth session exists.

### Migration Strategy
1. Any code that accesses `DriverSession.driverId` is already using the auth session (with dev fallback)
2. New code should prefer direct auth access: `Supabase.instance.client.auth.currentUser?.id`
3. Existing usages are safe and do not need changes
4. The helper documentation prevents future misuse

## Testing
Run the identity resolution tests:
```bash
cd apps/driver
flutter test test/driver_session_test.dart -v
```

## Related Issues
- Issue #802: Original trip/location service fixes (prior to this PR)
- Issue #1010: RLS policies for location data access control
