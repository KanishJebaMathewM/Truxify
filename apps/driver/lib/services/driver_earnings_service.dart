import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

class DriverEarningsService {
  DriverEarningsService({SupabaseClient? client, http.Client? httpClient, String? apiBaseUrl,})
      : _providedClient = client,
      _httpClient = httpClient ?? http.Client(),
      _apiBaseUrl = (apiBaseUrl ?? defaultApiBaseUrl).replaceFirst(RegExp(r'/$'), '',);

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final SupabaseClient? _providedClient;
  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;
  final http.Client _httpClient;
  final String _apiBaseUrl;

  String? get driverId => _client.auth.currentUser?.id;

  Map<String, String> get _authHeaders {
    final token = _client.auth.currentSession?.accessToken;
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<List<Map<String, dynamic>>> fetchWalletTransactions({
    int page = 1,
    int limit = 50,
  }) async {
    if (driverId == null) return [];

    final uri = Uri.parse('$_apiBaseUrl/api/driver/wallet/history').replace(
      queryParameters: {'page': '$page', 'limit': '$limit'},
    );

    final response = await _httpClient.get(uri, headers: _authHeaders);
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        decoded['error']?.toString() ?? 'Failed to load wallet history.',
      );
    }

    final transactions = decoded['transactions'] as List<dynamic>? ?? [];
    return transactions
        .map((t) => Map<String, dynamic>.from(t as Map))
        .toList();
  }

  Future<List<Map<String, dynamic>>> fetchMonthlyEarnings({
    required DateTime month,
  }) async {
    if (driverId == null) return [];

    final start = DateTime(month.year, month.month, 1);
    final end = DateTime(month.year, month.month + 1, 1);
    final today = DateTime.now();

    final daysSinceMonthStart = today.difference(start).inDays + 1;
    final days = daysSinceMonthStart.clamp(1, 365);

    final uri = Uri.parse('$_apiBaseUrl/api/driver/earnings/summary').replace(
      queryParameters: {'days': '$days'},
    );

    final response = await _httpClient.get(uri, headers: _authHeaders);
    final decoded = jsonDecode(response.body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded is Map ? decoded['error']?.toString() : null;
      throw Exception(error ?? 'Failed to load earnings summary.');
    }

    return (decoded as List<dynamic>)
        .map((e) => Map<String, dynamic>.from(e as Map))
        .where((e) {
      final date = DateTime.tryParse(e['day_date'].toString());
      if (date == null) return false;
      return !date.isBefore(start) && date.isBefore(end);
    }).toList();
  }

  Future<List<Map<String, dynamic>>> fetchCompletedTripsForDay({
    required DateTime date,
  }) async {
    if (driverId == null) return [];

    final day = date.toIso8601String().split('T').first;

    final response = await _client
        .from('trips')
        .select()
        .eq('driver_id', driverId!)
        .eq('status', 'completed')
        .eq('trip_date', day)
        .order('created_at', ascending: false);

    return List<Map<String, dynamic>>.from(response);
  }
}
