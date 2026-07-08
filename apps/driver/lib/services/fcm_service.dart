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
  static bool _isInitialized = false;
  static final List<RemoteMessage> _pendingMessages = [];

  static String? get currentToken => _currentToken;
  static bool get isInitialized => _isInitialized;

  static Future<void> initializeAndRegister() async {
    try {
      _isInitialized = true;
      final messaging = FirebaseMessaging.instance;

      FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
      FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        _pendingMessages.add(initialMessage);
      }

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
    debugPrint('[FCM] Foreground message: ${message.messageId}');
  }

  static void _handleNotificationTap(RemoteMessage message) {
    debugPrint('[FCM] Notification tapped: ${message.messageId}');
    _pendingMessages.add(message);
  }

  static List<RemoteMessage> consumePendingMessages() {
    final messages = List<RemoteMessage>.from(_pendingMessages);
    _pendingMessages.clear();
    return messages;
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
    final userId = firebaseUser?.uid;
    if (userId == null) {
      debugPrint('[FCM] No authenticated user, skipping token upload.');
      return;
    }
    final accessToken = await firebaseUser?.getIdToken();
    final fullName = firebaseUser?.displayName;

    final response = await http.put(
      Uri.parse('$_apiBaseUrl/api/profile/fcm-token'),
      headers: <String, String>{
        'Content-Type': 'application/json',
        if (accessToken != null && accessToken.isNotEmpty) 'Authorization': 'Bearer $accessToken',
        'x-user-id': userId,
        'x-user-role': 'driver',
        if (fullName != null && fullName.isNotEmpty) 'x-user-name': fullName,
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
