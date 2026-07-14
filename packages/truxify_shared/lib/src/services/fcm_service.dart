import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';

/// Centralized Firebase Cloud Messaging service.
///
/// Handles FCM token registration, unregistration, and refresh for both
/// customer and driver apps using [ApiClient] for all backend communication.
///
/// An optional [ApiClient] instance can be injected via [apiClient] to avoid
/// creating throwaway instances. If omitted, a new instance is created and
/// disposed per call (backward-compatible default).
class FcmService {
  static Future<void> initializeAndRegister({ApiClient? apiClient}) async {
    try {
      final messaging = FirebaseMessaging.instance;

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
    } catch (e) {
      debugPrint('[FCM] Initialization or registration failed: $e');
    }
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
