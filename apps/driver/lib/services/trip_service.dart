import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';

class TripService {
  TripService({
    SupabaseClient? client,
    ApiClient? apiClient,
    String? apiBaseUrl,
  })  : _providedClient = client,
        _apiClient = apiClient ?? ApiClient(baseUrl: apiBaseUrl),
        _apiBaseUrl = _normalizeBaseUrl(apiBaseUrl ?? defaultApiBaseUrl);

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
  );

  final SupabaseClient? _providedClient;
  final ApiClient _apiClient;
  final String _apiBaseUrl;

  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;

  String? _lastErrorMessage;
  bool _isDisposed = false;

  String _requireNonEmpty(String value, String name) {
    if (value.isEmpty) throw ArgumentError('$name must not be empty');
    return value;
  }

  Map<String, dynamic> _sanitizePayload(Map<String, dynamic> payload) {
    payload.removeWhere((k, v) => v == null);
    return payload;
  }

  String get _driverId {
    final user = _client.auth.currentUser;
    if (user == null) {
      _lastErrorMessage = 'Driver not authenticated';
      throw Exception(_lastErrorMessage);
    }
    return user.id;
  }

  static String _normalizeBaseUrl(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }

  static int _positiveInt(dynamic value, int fallback) {
    if (value == null) return fallback;
    if (value is int && value > 0) return value;
    if (value is num && value.isFinite && value > 0) return value.toInt();
    if (value is String) {
      final parsed = int.tryParse(value);
      if (parsed != null && parsed > 0) return parsed;
    }
    return fallback;
  }

  String _encodePathSegment(String value) => Uri.encodeComponent(value);

  Future<void> verifyTripOwnership(String tripDisplayId) async {
    final tripCheck = await _client
        .from('trips')
        .select('id')
        .eq('trip_display_id', tripDisplayId)
        .eq('driver_id', _driverId)
        .maybeSingle();

    if (tripCheck == null) {
      throw Exception('Unauthorized access to trip data');
    }
  }

  Future<List<Map<String, dynamic>>> fetchTrips({String? status}) async {
    var path = '/api/driver/trips';
    if (status != null) {
      path += '?status=${Uri.encodeQueryComponent(status)}';
    }
    
    try {
      final body = await _apiClient.get(path);
      if (body is Map<String, dynamic>) {
        return List<Map<String, dynamic>>.from(body['trips'] as List? ?? []);
      }
      if (body is! List) throw StateError('Unexpected trips response type');
      return List<Map<String, dynamic>>.from(body);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<Map<String, dynamic>> fetchTripHistory({
    String? cursor,
    int limit = 20,
    String? status,
  }) async {
    final page = int.tryParse(cursor ?? '1');
    if (page == null || page < 1) {
      throw ArgumentError.value(cursor, 'cursor', 'must be a positive integer');
    }
    if (limit < 1) {
      throw ArgumentError.value(limit, 'limit', 'must be a positive integer');
    }
    var path = '/api/driver/trips?page=$page&limit=$limit';
    if (status != null) {
      path += '&status=${Uri.encodeQueryComponent(status)}';
    }
    
    try {
      final body = await _apiClient.get(path);
      if (body is! Map<String, dynamic>) {
        throw StateError('Unexpected trip history response type');
      }
      final trips = body['trips'];
      if (trips is! List) {
        throw StateError('Unexpected trip history trips type');
      }
      final responsePage = _positiveInt(body['page'], page);
      final totalPages = _positiveInt(body['totalPages'], responsePage);
      final hasMore = responsePage < totalPages;
      return {
        'trips': List<Map<String, dynamic>>.from(trips),
        'nextCursor': hasMore ? '${responsePage + 1}' : null,
        'hasMore': hasMore,
      };
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> fetchTripItems(
    String tripDisplayId,
  ) async {
    final path = '/api/trips/${_encodePathSegment(tripDisplayId)}/items';
    try {
      final body = await _apiClient.get(path);
      if (body is! List) {
        throw StateError('Unexpected trip items response type');
      }
      return List<Map<String, dynamic>>.from(body);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> fetchTripStops(
    String tripDisplayId,
  ) async {
    final path = '/api/trips/${_encodePathSegment(tripDisplayId)}/stops';
    try {
      final body = await _apiClient.get(path);
      if (body is! List) {
        throw StateError('Unexpected trip stops response type');
      }
      return List<Map<String, dynamic>>.from(body);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> fetchRouteMapPoints(
    String tripDisplayId,
  ) async {
    final path = '/api/trips/${_encodePathSegment(tripDisplayId)}/route-points';
    try {
      final body = await _apiClient.get(path);
      if (body is! List) {
        throw StateError('Unexpected route points response type');
      }
      return List<Map<String, dynamic>>.from(body);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<void> markStopCompleted(
    String stopId,
    String tripDisplayId,
  ) async {
    await verifyTripOwnership(tripDisplayId);
    final path = '/api/trips/${_encodePathSegment(tripDisplayId)}/stops/${_encodePathSegment(stopId)}/complete';
    try {
      await _apiClient.put(path);
    } catch (e) {
      if (e is ApiException) throw Exception(e.message);
      rethrow;
    }
  }

  Future<void> updateOnlineStatus(bool isOnline) async {
    final path = '/api/driver/online';
    try {
      await _apiClient.put(
        path,
        body: <String, dynamic>{'is_online': isOnline},
      );
    } catch (e) {
      if (e is ApiException) throw Exception(e.message);
      rethrow;
    }
  }

  Future<void> startTrip(String tripDisplayId) async {
    await verifyTripOwnership(tripDisplayId);
    final path = '/api/trips/${_encodePathSegment(tripDisplayId)}/start';
    try {
      await _apiClient.put(path);
    } catch (e) {
      if (e is ApiException) throw Exception(e.message);
      rethrow;
    }
  }

  Future<void> setRoutePointClaimed(String pointId, bool claimed) async {
    final path = '/api/driver/route-points/${_encodePathSegment(pointId)}/claim';
    try {
      await _apiClient.patch(
        path,
        body: <String, dynamic>{'claimed': claimed},
      );
    } catch (e) {
      if (e is ApiException) throw Exception(e.message);
      rethrow;
    }
  }

  void dispose() {
    _isDisposed = true;
    _apiClient.dispose();
  }
}
