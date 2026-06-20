import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

class DriverEarningsService {
  DriverEarningsService({
    SupabaseClient? client,
    http.Client? httpClient,
    String? apiBaseUrl,
  })  : _providedClient = client,
        _isClientOwned = httpClient == null,
        _httpClient = httpClient ?? http.Client(),
        _apiBaseUrl = (apiBaseUrl ?? defaultApiBaseUrl).replaceFirst(RegExp(r'/$'), '',);

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final SupabaseClient? _providedClient;
  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;
  final http.Client _httpClient;
  final bool _isClientOwned;
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

    final http.Response response;
    try {
      response = await _httpClient.get(uri, headers: _authHeaders);
    } catch (e) {
      throw Exception('Network error: Failed to fetch wallet history.');
    }

    final dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw Exception('Failed to parse wallet history response.');
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final errorMsg = (decoded is Map) ? decoded['error']?.toString() : null;
      throw Exception(errorMsg ?? 'Failed to load wallet history.');
    }

    if (decoded is! Map) {
      throw Exception('Invalid wallet history response format.');
    }

    final transactions = decoded['transactions'];
    if (transactions is! List) {
      return [];
    }

    return transactions
        .map((t) {
          if (t is! Map) return null;
          return Map<String, dynamic>.from(t);
        })
        .whereType<Map<String, dynamic>>()
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

    // Fallback: If we query a historical month > 365 days ago,
    // the backend API will reject it or return incomplete data.
    // We fetch directly from the Supabase client for these older months.
    if (daysSinceMonthStart > 365) {
      final response = await _client
          .from('earnings_daily')
          .select()
          .eq('driver_id', driverId!)
          .gte('day_date', start.toIso8601String().split('T').first)
          .lt('day_date', end.toIso8601String().split('T').first)
          .order('day_date');
      return List<Map<String, dynamic>>.from(response);
    }

    final days = daysSinceMonthStart.clamp(1, 365);

    final uri = Uri.parse('$_apiBaseUrl/api/driver/earnings/summary').replace(
      queryParameters: {'days': '$days'},
    );

    final http.Response response;
    try {
      response = await _httpClient.get(uri, headers: _authHeaders);
    } catch (e) {
      throw Exception('Network error: Failed to fetch earnings summary.');
    }

    final dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw Exception('Failed to parse earnings summary response.');
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded is Map ? decoded['error']?.toString() : null;
      throw Exception(error ?? 'Failed to load earnings summary.');
    }

    if (decoded is! List) {
      throw Exception('Invalid earnings summary response format.');
    }

    return decoded
        .map((e) {
          if (e is! Map) return null;
          return Map<String, dynamic>.from(e);
        })
        .whereType<Map<String, dynamic>>()
        .where((e) {
          final dateStr = e['day_date'];
          if (dateStr == null) return false;
          final date = DateTime.tryParse(dateStr.toString());
          if (date == null) return false;
          return !date.isBefore(start) && date.isBefore(end);
        })
        .toList();
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

  Future<Map<String, dynamic>> fetchWalletSummary() async {
    if (driverId == null) return {};

    final response = await _client
        .from('driver_details')
        .select('wallet_confirmed, wallet_pending, wallet_total')
        .eq('user_id', driverId!);

    if (response is List && response.isNotEmpty) {
      return Map<String, dynamic>.from(response.first as Map);
    }
    return {};
  }

  void dispose() {
    if (_isClientOwned) {
      _httpClient.close();
    }
  }
}
