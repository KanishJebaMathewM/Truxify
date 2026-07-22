import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/earnings_daily_model.dart';
import 'api_client.dart';

class DriverEarningsService {
  DriverEarningsService({
    SupabaseClient? client,
    ApiClient? apiClient,
    String? apiBaseUrl,
    http.Client? httpClient,
  })  : _providedClient = client,
        _apiClient = apiClient ?? ApiClient(baseUrl: apiBaseUrl, httpClient: httpClient);

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
  );

  final SupabaseClient? _providedClient;
  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;
  final ApiClient _apiClient;

  final Map<String, dynamic> _cache = {};
  static const Duration _cacheTtl = Duration(minutes: 5);
  DateTime? _lastCacheTime;

  bool _isCacheValid() {
    if (_cache.isEmpty) return false;
    if (_lastCacheTime == null) return false;
    return DateTime.now().difference(_lastCacheTime!) < _cacheTtl;
  }

  void _clearCache() {
    _cache.clear();
    _lastCacheTime = null;
  }

  void _updateCache(Map<String, dynamic> data) {
    _cache.clear();
    _cache.addAll(data);
    _lastCacheTime = DateTime.now();
  }

  Future<Map<String, dynamic>?> _getCached(String key) async {
    if (!_isCacheValid()) return null;
    return _cache[key] as Map<String, dynamic>?;
  }

  DateTime? _parseDate(String dateStr) {
    try {
      return DateTime.parse(dateStr);
    } catch (_) {
      return null;
    }
  }

  bool _isWithinRange(DateTime target, DateTime? start, DateTime? end) {
    if (start != null && target.isBefore(start)) return false;
    if (end != null && target.isAfter(end)) return false;
    return true;
  }

  List<Map<String, dynamic>> _mapResponseRows(Object? response, String label) {
    if (response is! List) {
      throw StateError('Unexpected $label response type');
    }
    return response.map((item) {
      if (item is Map<String, dynamic>) return item;
      if (item is Map) return Map<String, dynamic>.from(item);
      throw StateError('Unexpected $label item type');
    }).toList(growable: false);
  }

  String? get driverId => _client.auth.currentUser?.id;

  Future<List<Map<String, dynamic>>> fetchWalletTransactions({
    int page = 1,
    int limit = 50,
  }) async {
    if (driverId == null) return [];

    final path = '/api/driver/wallet/history?page=$page&limit=$limit';

    try {
      final decoded = await _apiClient.get(path);
      
      if (decoded is! Map) {
        throw Exception('Invalid wallet history response format.');
      }

      final transactions = decoded['transactions'];
      if (transactions is! List) {
        throw StateError('Unexpected wallet transactions response type');
      }

      return transactions
          .map((t) {
            if (t is! Map) return null;
            return Map<String, dynamic>.from(t);
          })
          .whereType<Map<String, dynamic>>()
          .toList();
    } catch (e) {
      if (e is StateError) {
        throw Exception(e.message);
      }
      if (e is ApiException) {
        throw Exception(e.message.isNotEmpty ? e.message : 'Failed to load wallet history.');
      }
      throw Exception('Network error: Failed to fetch wallet history.');
    }
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
      if (response is! List) {
        throw StateError('Unexpected monthly earnings response type');
      }
      return response.map((item) {
        if (item is Map<String, dynamic>) return item;
        if (item is Map) return Map<String, dynamic>.from(item);
        throw StateError('Unexpected monthly earnings item type');
      }).toList(growable: false);
    }

    final days = daysSinceMonthStart.clamp(1, 365);

    final path = '/api/driver/earnings/summary?days=$days';

    try {
      final decoded = await _apiClient.get(path);
      
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
    } catch (e) {
      if (e is ApiException) {
        throw Exception(e.message.isNotEmpty ? e.message : 'Failed to load earnings summary.');
      }
      throw Exception('Network error: Failed to fetch earnings summary.');
    }
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

    return _mapResponseRows(response, 'completed trips');
  }

  /// Fetches today's earnings summary (amount, hours driven, trip count).
  Future<EarningsDailyModel?> fetchTodayEarningsSummary() async {
    if (driverId == null) return null;

    final today = DateTime.now();
    final dayStr = today.toIso8601String().split('T').first;

    final path = '/api/driver/earnings/summary?days=1';

    try {
      final decoded = await _apiClient.get(path);
      
      if (decoded is! List) {
        throw StateError('Unexpected earnings summary response type');
      }

      for (final entry in decoded) {
        if (entry is! Map) {
          throw StateError('Unexpected earnings summary item type');
        }
        final dateStr = entry['day_date']?.toString();
        if (dateStr == dayStr) {
          return EarningsDailyModel.fromMap(Map<String, dynamic>.from(entry));
        }
      }

      return null;
    } catch (e) {
      if (e is StateError) {
        throw Exception(e.message);
      }
      if (e is ApiException) {
        throw Exception(e.message.isNotEmpty ? e.message : 'Failed to load today\'s earnings.');
      }
      throw Exception('Network error: Failed to fetch today\'s earnings.');
    }
  }

  /// Fetches driver stats including rating, total trips, completion rate.
  Future<Map<String, dynamic>> fetchDriverStats() async {
    if (driverId == null) return {};

    final path = '/api/driver/stats';

    try {
      final decoded = await _apiClient.get(path);
      
      if (decoded is! Map) {
        throw StateError('Unexpected driver stats response type');
      }

      final stats = decoded['stats'];
      if (stats == null) return {};
      if (stats is Map<String, dynamic>) return stats;
      if (stats is Map) return Map<String, dynamic>.from(stats);
      throw StateError('Unexpected driver stats payload type');
    } catch (e) {
      if (e is StateError) {
        throw Exception(e.message);
      }
      if (e is ApiException) {
        throw Exception(e.message.isNotEmpty ? e.message : 'Failed to load driver stats.');
      }
      throw Exception('Network error: Failed to fetch driver stats.');
    }
  }

  Future<Map<String, dynamic>> fetchWalletSummary() async {
    if (driverId == null) return {};

    final response = await _client
        .from('driver_details')
        .select('wallet_confirmed, wallet_pending, wallet_total')
        .eq('user_id', driverId!);

    if (response is! List) {
      throw StateError('Unexpected wallet summary response type');
    }
    if (response.isNotEmpty) {
      final first = response.first;
      if (first is Map<String, dynamic>) return first;
      if (first is Map) return Map<String, dynamic>.from(first);
      throw StateError('Unexpected wallet summary item type');
    }
    return {};
  }

  /// Withdraws funds from the driver's confirmed wallet balance.
  ///
  /// [amountPaisa] must be a positive integer representing the amount in paisa.
  ///
  /// Throws [ApiException] on non-2xx responses with the server error message.
  /// Throws a generic [Exception] on network errors.
  Future<void> withdrawFunds(int amountPaisa) async {
    if (driverId == null) {
      throw Exception('You must be logged in to withdraw funds.');
    }

    final path = '/api/driver/wallet/withdraw';

    try {
      await _apiClient.post(path, body: {
        'amount': amountPaisa,
      });
    } on ApiException {
      rethrow;
    } catch (e) {
      throw Exception('Network error: Failed to withdraw funds.');
    }
  }

  /// Fetches the driver's earnings statement for a date range.
  ///
  /// When [format] is `"json"`, returns parsed JSON data.
  /// When [format] is `"csv"`, returns the raw CSV as a [String].
  Future<dynamic> fetchStatement({
    required DateTime startDate,
    required DateTime endDate,
    String format = "json",
  }) async {
    final startStr =
        '${startDate.year}-${startDate.month.toString().padLeft(2, '0')}-${startDate.day.toString().padLeft(2, '0')}';
    final endStr =
        '${endDate.year}-${endDate.month.toString().padLeft(2, '0')}-${endDate.day.toString().padLeft(2, '0')}';

    final path =
        '/api/profile/driver/statement?start_date=$startStr&end_date=$endStr&format=$format';

    if (format == 'csv') {
      try {
        final raw = await _apiClient.getRaw(path);
        return raw;
      } on ApiException {
        rethrow;
      } catch (e) {
        throw Exception('Network error: Failed to fetch statement CSV.');
      }
    }

    try {
      final decoded = await _apiClient.get(path);
      return decoded;
    } on ApiException {
      rethrow;
    } catch (e) {
      throw Exception('Network error: Failed to fetch earnings statement.');
    }
  }

  void dispose() {
    _apiClient.dispose();
  }
}
