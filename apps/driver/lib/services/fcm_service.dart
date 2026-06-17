import 'dart:convert';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter/foundation.dart';

class FcmService {
  static const String _apiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  static Future<void> initializeAndRegister() async {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }

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
    final client = Supabase.instance.client;
    final userId = client.auth.currentUser?.id;
    if (userId == null) {
      debugPrint('[FCM] No authenticated user, skipping token upload.');
      return;
    }
    final accessToken = client.auth.currentSession?.accessToken;
    final fullName = client.auth.currentUser?.userMetadata?['full_name']?.toString();

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
