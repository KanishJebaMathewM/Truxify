# Implementation Specification: Issue #1493 - FCM Token Invalidation

## Problem
FCM push notification tokens stored on server but never invalidated on logout, enabling notification hijacking on shared devices.

## Implementation Details

### Backend Changes

**File: `backend/api/src/services/auth.service.js`** (modify logout method)

```javascript
async logout(userId) {
  // Get user's FCM token
  const fcmToken = await db.query(
    'SELECT fcm_token FROM drivers WHERE id = ?', [userId]
  );

  // Invalidate token in Firebase
  if (fcmToken) {
    await admin.messaging().sendMulticast({
      tokens: [fcmToken],
      notification: { title: 'Logged out' }
    });
  }

  // Delete from database
  await db.query(
    'UPDATE drivers SET fcm_token = NULL WHERE id = ?', [userId]
  );

  // Log event
  await auditLog.create({
    userId,
    action: 'LOGOUT',
    fcm_token_invalidated: true
  });

  return { success: true };
}
```

### Flutter Changes

**File: `apps/driver/lib/services/fcm_service.dart`** (modify)

```dart
class FCMService {
  Future<void> logout() async {
    // Disable token refresh
    await messaging.deleteToken();
    
    // Clear local storage
    await prefs.remove('fcm_token');
    
    // Notify backend
    await api.post('/logout', {
      'fcm_token': await messaging.getToken()
    });
  }
}
```

### Testing

- Test token deleted from DB on logout
- Test token cleared from device
- Test background token refresh disabled
- Test 30-day re-auth policy enforced

## Closes #1493
