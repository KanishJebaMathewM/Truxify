import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:http/http.dart' as http;
import 'package:flutter/foundation.dart';

class FcmService {
  static const String _apiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  static String? _currentToken;
  static bool _initialized = false;

  static String? get currentToken => _currentToken;
  static bool get isInitialized => _initialized;

  static Future<void> initializeAndRegister() async {
    try {
      _initialized = true;
      final messaging = FirebaseMessaging.instance;

      FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
      FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);

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
          _currentToken = token;
          await _sendTokenToBackend(token);
        }

        messaging.onTokenRefresh.listen((newToken) async {
          _currentToken = newToken;
          await _sendTokenToBackend(newToken);
        });
      } else {
        debugPrint('[FCM] Notification permissions denied.');
      }
    } catch (e) {
      debugPrint('[FCM] Initialization or registration failed: $e');
    }
  }

  static void _handleForegroundMessage(RemoteMessage message) {
    debugPrint('[FCM Customer] Foreground notification: ${message.notification?.title}');
  }

  static void _handleNotificationTap(RemoteMessage message) {
    debugPrint('[FCM Customer] Notification tapped: ${message.notification?.title}');
  }

  static Future<void> clearToken() async {
    try {
      _currentToken = null;
      await _sendTokenToBackend(null);
    } catch (e) {
      debugPrint('[FCM] Clearing token failed: $e');
    }
  }

  static Future<void> _sendTokenToBackend(String? token) async {
    final firebaseUser = FirebaseAuth.instance.currentUser;
    if (firebaseUser == null) {
      debugPrint('[FCM] No authenticated user, skipping token upload.');
      return;
    }

    final idToken = await firebaseUser.getIdToken();

    final response = await http.put(
      Uri.parse('$_apiBaseUrl/api/profile/fcm-token'),
      headers: <String, String>{
        'Content-Type': 'application/json',
        'x-user-role': 'customer',
        if (idToken != null && idToken.isNotEmpty)
          'Authorization': 'Bearer $idToken',
      },
      body: jsonEncode(<String, dynamic>{
        'fcmToken': token,
      }),
    );

    if (response.statusCode >= 200 && response.statusCode < 300) {
      debugPrint('[FCM] Token updated successfully on backend: $token');
    } else {
      debugPrint('[FCM] Failed to update token on backend: ${response.body}');
    }
  }
}
