import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'notification_router.dart';
import '../models/notification_payload.dart';

/// Callback invoked when a foreground message is received.
/// Apps use this to show an in-app banner/snackbar.
typedef ForegroundMessageCallback = void Function(
    RemoteMessage message, NotificationPayload payload);

/// Callback invoked when a notification is tapped (background or cold-start).
/// Apps use this to navigate to the appropriate screen.
typedef NotificationTapCallback = void Function(NotificationPayload payload);

/// Centralized Firebase Cloud Messaging service.
///
/// Handles FCM token registration, unregistration, refresh, and message
/// handling (foreground, background, closed state) for both customer and
/// driver apps.
///
/// An optional [ApiClient] instance can be injected via [apiClient] to avoid
/// creating throwaway instances. If omitted, a new instance is created and
/// disposed per call (backward-compatible default).
class FcmService {
  static bool _initialized = false;
  static ForegroundMessageCallback? _foregroundCallback;
  static NotificationTapCallback? _tapCallback;

  /// Registers a callback for foreground messages.
  static void setForegroundCallback(ForegroundMessageCallback callback) {
    _foregroundCallback = callback;
  }

  static void clearForegroundCallback() {
    _foregroundCallback = null;
  }

  /// Registers a callback for notification taps (background/cold-start).
  static void setTapCallback(NotificationTapCallback callback) {
    _tapCallback = callback;
  }

  static void clearTapCallback() {
    _tapCallback = null;
  }

  /// Must be called once during app startup.
  /// Sets up all FCM message listeners and token registration.
  ///
  /// Note: [getInitialMessage] (cold-start) is NOT handled here — it should
  /// be called from the app's shell after the widget tree is built, via
  /// [handleInitialMessage].
  static Future<void> initializeAndRegister({ApiClient? apiClient}) async {
    if (_initialized) {
      debugPrint('[FCM] Already initialized, skipping.');
      return;
    }
    _initialized = true;

    try {
      final messaging = FirebaseMessaging.instance;

      // ── Background message handler (must be registered before any other listener) ──
      FirebaseMessaging.onBackgroundMessage(backgroundMessageHandler);

      final settings = await messaging.requestPermission(
        alert: true,
        announcement: false,
        badge: true,
        carPlay: false,
        criticalAlert: false,
        provisional: false,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.authorized ||
          settings.authorizationStatus == AuthorizationStatus.provisional) {
        final token = await messaging.getToken();
        if (token != null) {
          await _sendTokenToBackend(token, apiClient: apiClient);
        }

        messaging.onTokenRefresh.listen((newToken) async {
          await _sendTokenToBackend(newToken, apiClient: apiClient);
        });
      } else {
        debugPrint('[FCM] Notification permissions denied.');
      }

      // ── Foreground messages ──────────────────────────────────────
      FirebaseMessaging.onMessage.listen(_handleForegroundMessage);

      // ── Tap on background notification ──
      FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);
    } catch (e) {
      debugPrint('[FCM] Initialization or registration failed: $e');
    }
  }

  /// Handles the cold-start notification. Must be called from the app's
  /// shell after the widget tree is built (e.g., in didChangeDependencies
  /// or a post-frame callback). Returns true if a notification was handled.
  static Future<bool> handleInitialMessage() async {
    try {
      final messaging = FirebaseMessaging.instance;
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        _handleNotificationTap(initialMessage);
        return true;
      }
    } catch (e) {
      debugPrint('[FCM] handleInitialMessage failed: $e');
    }
    return false;
  }

  /// Resets the initialized flag (useful for testing).
  static void resetInitialized() {
    _initialized = false;
  }

  /// Handles a foreground message by parsing the payload and invoking
  /// the foreground callback.
  static void _handleForegroundMessage(RemoteMessage message) {
    final payload = NotificationPayload.fromMap(message.data);
    debugPrint('[FCM] Foreground message received: type=${payload.type}');

    final callback = _foregroundCallback;
    if (callback != null) {
      callback(message, payload);
    } else {
      debugPrint('[FCM] No foreground callback registered.');
    }
  }

  /// Handles a notification tap (from background or terminated state).
  static void _handleNotificationTap(RemoteMessage message) {
    final payload = NotificationPayload.fromMap(message.data);
    debugPrint('[FCM] Notification tapped: type=${payload.type}');

    final callback = _tapCallback;
    if (callback != null) {
      callback(payload);
    } else {
      debugPrint('[FCM] No tap callback registered.');
    }
  }

  /// Background message handler — must be a top-level function.
  @pragma('vm:entry-point')
  static Future<void> backgroundMessageHandler(RemoteMessage message) async {
    final payload = NotificationPayload.fromMap(message.data);
    debugPrint('[FCM] Background message received: type=${payload.type}');
    // Background messages are handled when the user taps the notification,
    // which triggers onMessageOpenedApp or getInitialMessage.
  }

  /// Unregisters the current device's FCM token from the backend.
  /// Must be called before signing out so a logged-out device stops
  /// receiving push notifications intended for the next user of a
  /// shared device.
  static Future<void> unregisterToken({ApiClient? apiClient}) async {
    try {
      final messaging = FirebaseMessaging.instance;
      final token = await messaging.getToken();
      if (token == null) {
        return;
      }
      await _unregisterTokenFromBackend(token, apiClient: apiClient);
    } catch (e) {
      debugPrint('[FCM] Unregistering token failed: $e');
    }
  }

  static Future<void> _unregisterTokenFromBackend(
    String token, {
    ApiClient? apiClient,
  }) async {
    final firebaseUser = FirebaseAuth.instance.currentUser;
    if (firebaseUser == null) {
      debugPrint('[FCM] No authenticated user, skipping token unregister.');
      return;
    }

    final ownsClient = apiClient == null;
    final client = apiClient ?? ApiClient();
    try {
      await client.post(
        '/api/devices/unregister',
        body: <String, dynamic>{
          'fcmToken': token,
        },
      );
      debugPrint('[FCM] Device token unregistered successfully.');
    } catch (e) {
      debugPrint('[FCM] Failed to unregister device token: $e');
    } finally {
      if (ownsClient) client.dispose();
    }
  }

  static Future<void> clearToken({ApiClient? apiClient}) async {
    try {
      await _sendTokenToBackend(null, apiClient: apiClient);
    } catch (e) {
      debugPrint('[FCM] Clearing token failed: $e');
    }
  }

  static Future<void> _sendTokenToBackend(
    String? token, {
    ApiClient? apiClient,
  }) async {
    final firebaseUser = FirebaseAuth.instance.currentUser;
    if (firebaseUser == null) {
      debugPrint('[FCM] No authenticated user, skipping token upload.');
      return;
    }

    final ownsClient = apiClient == null;
    final client = apiClient ?? ApiClient();
    try {
      await client.put(
        '/api/profile/fcm-token',
        body: <String, dynamic>{
          'fcmToken': token,
        },
      );
      debugPrint('[FCM] Token updated successfully on backend.');
    } catch (e) {
      debugPrint('[FCM] Failed to update token on backend: $e');
    } finally {
      if (ownsClient) client.dispose();
    }
  }
}
