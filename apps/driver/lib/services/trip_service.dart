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
      'x-user-id': userId,
      'x-user-role': 'driver',
    };
  }

  Future<void> _verifyTripOwnership(String tripDisplayId) async {
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
    var uriString = '$_apiBaseUrl/api/trips';
    if (status != null) {
      uriString += '?status=${Uri.encodeQueryComponent(status)}';
    }
    final uri = Uri.parse(uriString);
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch trips');
    }

    final body = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(body as List);
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
    await _verifyTripOwnership(tripDisplayId);

    final updatedStop = await _client.from('trip_stops').update({
      'is_completed': true,
      'is_current': false,
    }).eq('id', stopId).eq('trip_display_id', tripDisplayId).select().maybeSingle();

    if (updatedStop == null) {
      throw Exception('Stop not found or does not belong to this trip');
    }

    final nextStops = await _client
        .from('trip_stops')
        .select()
        .eq('trip_display_id', tripDisplayId)
        .eq('is_completed', false)
        .order('sort_order')
        .limit(1);

    if (nextStops.isNotEmpty) {
      await _client
          .from('trip_stops')
          .update({'is_current': true})
          .eq('id', nextStops.first['id'])
          .eq('trip_display_id', tripDisplayId);
    } else {
      await _client
          .from('trips')
          .update({'status': 'completed'})
          .eq('trip_display_id', tripDisplayId)
          .eq('driver_id', _driverId);
    }
  }
  Future<void> updateOnlineStatus(bool isOnline) async {
    final updated = await _client
        .from('driver_details')
        .update({
          'is_online': isOnline,
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('user_id', _driverId)
        .select()
        .maybeSingle();

    if (updated == null) {
      throw Exception('Driver profile not found or update failed');
    }
  }

  Future<void> startTrip(String tripDisplayId) async {
    await _verifyTripOwnership(tripDisplayId);

    // Find the first stop of this trip that is not completed
    final stops = await _client
        .from('trip_stops')
        .select()
        .eq('trip_display_id', tripDisplayId)
        .eq('is_completed', false)
        .order('sort_order')
        .limit(1);

    if (stops.isEmpty) {
      throw Exception('No active stops found for this trip');
    }

    final firstStopId = stops.first['id'];
    final updatedStop = await _client
        .from('trip_stops')
        .update({'is_current': true})
        .eq('id', firstStopId)
        .eq('trip_display_id', tripDisplayId)
        .select()
        .maybeSingle();

    if (updatedStop == null) {
      throw Exception('Failed to start trip: Stop not found or update failed');
    }
  }
}
