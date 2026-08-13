import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  debugPrint('[FCM] Background message: ${message.messageId}');
  // Handle background data here
}

class FcmService {
  static final ApiClient apiClient = ApiClient();
  static bool _initialized = false;
  static StreamSubscription<String>? _tokenRefreshSub;
  static Future<void> initializeAndRegister() async {
    if (_initialized) return;
    _initialized = true;
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
          await _sendTokenToBackend(token);
        }

        _tokenRefreshSub?.cancel();
        _tokenRefreshSub = messaging.onTokenRefresh.listen((newToken) async {
          await _sendTokenToBackend(newToken);
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
  static Future<void> unregisterToken() async {
    try {
      final messaging = FirebaseMessaging.instance;
      final token = await messaging.getToken();
      if (token == null) {
        return;
      }
      await _unregisterTokenFromBackend(token);
    } catch (e) {
      debugPrint('[FCM] Unregistering token failed: $e');
    }
  }

  static Future<void> _unregisterTokenFromBackend(String token) async {
    final firebaseUser = FirebaseAuth.instance.currentUser;
    final supabaseUser = _currentSupabaseUser();
    if (firebaseUser == null && supabaseUser == null) {
      debugPrint('[FCM] No authenticated user, skipping token unregister.');
      return;
    }

    final apiClient = ApiClient();
    try {
      await apiClient.post(
        '/api/devices/unregister',
        body: <String, dynamic>{
          'fcmToken': token,
          'userId': firebaseUser?.uid ?? supabaseUser?.id,
        },
      );
      debugPrint('[FCM] Device token unregistered successfully.');
    } catch (e) {
      debugPrint('[FCM] Failed to unregister device token: $e');
    } finally {
      apiClient.dispose();
    }
  }

  /// Returns the currently signed-in Supabase user, or null if Supabase is
  /// not configured/initialized or no user is signed in.
  static User? _currentSupabaseUser() {
    try {
      return Supabase.instance.client.auth.currentUser;
    } catch (_) {
      return null;
    }
  }

  static Future<void> clearToken() async {
    try {
      await _sendTokenToBackend(null);
    } catch (e) {
      debugPrint('[FCM] Clearing token failed: $e');
    }
  }

  static Future<void> _sendTokenToBackend(String? token) async {
    final firebaseUser = FirebaseAuth.instance.currentUser;
    final supabaseUser = _currentSupabaseUser();
    final userId = firebaseUser?.uid ?? supabaseUser?.id;
    if (userId == null) {
      debugPrint('[FCM] No authenticated user, skipping token upload.');
      return;
    }
    final apiClient = ApiClient();
    try {
      await apiClient.put(
        '/api/profile/fcm-token',
        body: <String, dynamic>{
          'fcmToken': token,
          'userId': userId,
        },
      );
      debugPrint('[FCM] Token updated successfully on backend.');
    } catch (e) {
      debugPrint('[FCM] Failed to update token on backend: $e');
    } finally {
      apiClient.dispose();
    }
  }
}
export 'package:truxify_shared/src/services/fcm_service.dart' hide FcmService;
