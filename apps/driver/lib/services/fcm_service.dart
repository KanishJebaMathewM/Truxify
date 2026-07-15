import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'api_client.dart';

class FcmService {
  static final String _apiBaseUrl = 'http://localhost:5000';
  static final ApiClient apiClient = ApiClient();
  static Future<void> initializeAndRegister() async {
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

        messaging.onTokenRefresh.listen((newToken) async {
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
    if (firebaseUser == null) {
      debugPrint('[FCM] No authenticated user, skipping token unregister.');
      return;
    }

    final apiClient = ApiClient();
    try {
      await apiClient.post(
        '/api/devices/unregister',
        body: <String, dynamic>{
          'fcmToken': token,
        },
      );
      debugPrint('[FCM] Device token unregistered successfully.');
    } catch (e) {
      debugPrint('[FCM] Failed to unregister device token: $e');
    } finally {
      apiClient.dispose();
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
    final userId = firebaseUser?.uid;
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
export 'package:truxify_shared/src/services/fcm_service.dart';
