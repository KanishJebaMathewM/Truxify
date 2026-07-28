import 'dart:async';
import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;


import 'api_client.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  print('[FCM] Background message: ${message.messageId}');
  // Handle background data here
}

class FcmService {
  static const String _baseUrl = 'http://localhost:3000'; // your Node.js API

  static Future<void> initialize() async {
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

    // Request permission (iOS)
    await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    // Handle foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      print('[FCM] Foreground message: ${message.notification?.title}');
      // TODO: Show local notification using flutter_local_notifications
    });

    // Handle notification tap when app is in background
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      _handleNotificationTap(message);
    });

    // Handle notification tap when app was terminated
    final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) {
      _handleNotificationTap(initialMessage);
    }
  }

  static Future<void> registerTokenForUser(String userId) async {
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null) return;

    await http.post(
      Uri.parse('$_baseUrl/api/users/fcm-token'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'userId': userId, 'fcmToken': token}),
    );

    // Refresh token listener
    FirebaseMessaging.instance.onTokenRefresh.listen((newToken) async {
      await http.post(
        Uri.parse('$_baseUrl/api/users/fcm-token'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'userId': userId, 'fcmToken': newToken}),
      );
    });
  }

  static void _handleNotificationTap(RemoteMessage message) {
    final type = message.data['type'];
    final loadId = message.data['loadId'];
    // TODO: Use your app's navigator to route based on type
    // e.g. navigatorKey.currentState?.pushNamed('/load/$loadId')
    print('[FCM] Tapped: type=$type, loadId=$loadId');
  }
}

class FcmService {
  static final ApiClient apiClient = ApiClient();
  static bool _initialized = false;
  static StreamSubscription<String>? _tokenRefreshSub;

class FcmService {
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
export 'package:truxify_shared/src/services/fcm_service.dart' hide FcmService;
