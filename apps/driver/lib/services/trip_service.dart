import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

class TripService {
  TripService({
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

  String get _driverId {
    final user = _client.auth.currentUser;
    if (user == null) throw Exception('Driver not authenticated');
    return user.id;
  }

  static String _normalizeBaseUrl(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }

  Future<Map<String, String>> _authHeaders() async {
    final accessToken = await FirebaseAuth.instance.currentUser?.getIdToken();
    final userId = _client.auth.currentUser?.id ?? '';
    return <String, String>{
      'Content-Type': 'application/json',
      if (accessToken != null) 'Authorization': 'Bearer $accessToken',
    };
  }

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
    var uriString = '$_apiBaseUrl/api/driver/trips';
    if (status != null) {
      uriString += '?status=${Uri.encodeQueryComponent(status)}';
    }
    final uri = Uri.parse(uriString);
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch trips');
    }

    final body = jsonDecode(response.body);
    if (body is Map<String, dynamic>) {
      return List<Map<String, dynamic>>.from(body['trips'] as List? ?? []);
    }
    return List<Map<String, dynamic>>.from(body as List);
  }

  Future<Map<String, dynamic>> fetchTripHistory({
    String? cursor,
    int limit = 20,
    String? status,
  }) async {
    final page = int.tryParse(cursor ?? '1') ?? 1;
    var uriString = '$_apiBaseUrl/api/driver/trips?page=$page&limit=$limit';
    if (status != null) {
      uriString += '&status=${Uri.encodeQueryComponent(status)}';
    }
    final uri = Uri.parse(uriString);
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch trip history');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final responsePage = body['page'] as int? ?? page;
    final totalPages = body['totalPages'] as int? ?? responsePage;
    final hasMore = responsePage < totalPages;
    return {
      'trips': List<Map<String, dynamic>>.from(body['trips'] as List? ?? []),
      'nextCursor': hasMore ? '${responsePage + 1}' : null,
      'hasMore': hasMore,
    };
  }

  Future<List<Map<String, dynamic>>> fetchTripItems(
    String tripDisplayId,
  ) async {
    final uri = Uri.parse('$_apiBaseUrl/api/trips/$tripDisplayId/items');
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch trip items');
    }

    final body = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(body as List);
  }

  Future<List<Map<String, dynamic>>> fetchTripStops(
    String tripDisplayId,
  ) async {
    final uri = Uri.parse('$_apiBaseUrl/api/trips/$tripDisplayId/stops');
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch trip stops');
    }

    final body = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(body as List);
  }

  Future<List<Map<String, dynamic>>> fetchRouteMapPoints(
    String tripDisplayId,
  ) async {
    final uri = Uri.parse('$_apiBaseUrl/api/trips/$tripDisplayId/route-points');
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch route map points');
    }

    final body = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(body as List);
  }

  Future<void> markStopCompleted(
    String stopId,
    String tripDisplayId,
  ) async {
    await verifyTripOwnership(tripDisplayId);
    final uri = Uri.parse('$_apiBaseUrl/api/trips/$tripDisplayId/stops/$stopId/complete');
    final response = await _httpClient.put(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = jsonDecode(response.body) as Map<String, dynamic>?;
      throw Exception(body?['error'] as String? ?? 'Failed to mark stop completed');
    }
  }

  Future<void> updateOnlineStatus(bool isOnline) async {
    final uri = Uri.parse('$_apiBaseUrl/api/driver/online');
    final response = await _httpClient.put(
      uri,
      headers: await _authHeaders(),
      body: jsonEncode(<String, dynamic>{'is_online': isOnline}),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = jsonDecode(response.body) as Map<String, dynamic>?;
      throw Exception(body?['error'] as String? ?? 'Failed to update online status');
    }
  }

  Future<void> startTrip(String tripDisplayId) async {
    await verifyTripOwnership(tripDisplayId);
    final uri = Uri.parse('$_apiBaseUrl/api/trips/$tripDisplayId/start');
    final response = await _httpClient.put(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = jsonDecode(response.body) as Map<String, dynamic>?;
      throw Exception(body?['error'] as String? ?? 'Failed to start trip');
    }
  }
}
