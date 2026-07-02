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

  static Future<void> initializeAndRegister() async {
    try {
      // Firebase is already initialized in main.dart.

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

  static Future<void> clearToken() async {
    try {
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
        if (idToken != null && idToken.isNotEmpty)
          'Authorization': 'Bearer $idToken',
      },
      body: jsonEncode(<String, dynamic>{
        'fcmToken': token,
      }),
    );

    if (response.statusCode >= 200 && response.statusCode < 300) {
      debugPrint('[FCM] Token updated successfully on backend.');
    } else {
      debugPrint('[FCM] Failed to update token on backend: ${response.body}');
    }
  }
}
