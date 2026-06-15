import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_service.dart';

class ProfileService {
  ProfileService({
    SupabaseClient? client,
    http.Client? httpClient,
    String? apiBaseUrl,
  })  : _providedClient = client,
        _httpClient = httpClient ?? http.Client(),
        _apiBaseUrl = _normalizeBaseUrl(apiBaseUrl ?? defaultApiBaseUrl);

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final SupabaseClient? _providedClient;
  final http.Client _httpClient;
  final String _apiBaseUrl;

  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;

  static String _normalizeBaseUrl(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }

  Future<Map<String, dynamic>> fetchProfile() async {
    final userId = SupabaseService.requireUserId();
    final token = _client.auth.currentSession?.accessToken;
    final fullName = SupabaseService.currentUser?.userMetadata?['full_name']?.toString();

    final response = await _httpClient.get(
      Uri.parse('$_apiBaseUrl/api/profile'),
      headers: <String, String>{
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        'x-user-id': userId,
        'x-user-role': 'customer',
        if (fullName != null && fullName.isNotEmpty) 'x-user-name': fullName,
      },
    );

    Map<String, dynamic> body;
    try {
      body = response.body.isNotEmpty
          ? jsonDecode(response.body) as Map<String, dynamic>
          : <String, dynamic>{};
    } catch (_) {
      throw const FormatException('Invalid JSON response from server.');
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        body['error']?.toString() ?? 'Failed to fetch profile via backend API.',
      );
    }

    return body;
  }
}
