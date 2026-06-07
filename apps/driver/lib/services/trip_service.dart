import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class TripService {
  TripService({SupabaseClient? client}) : _providedClient = client;

  final SupabaseClient? _providedClient;

  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;

  Future<void> _verifyTripOwnership(
    String tripDisplayId,
    String driverId,
  ) async {
    final tripCheck = await _client
        .from('trips')
        .select('id')
        .eq('trip_display_id', tripDisplayId)
        .eq('driver_id', driverId)
        .maybeSingle();

    if (tripCheck == null) {
      throw Exception('Unauthorized access to trip data');
    }
  }

  Future<List<Map<String, dynamic>>> fetchActiveTrips() async {
    final driverId = _client.auth.currentUser?.id;
    if (driverId == null) throw Exception('User not authenticated');

    final response = await _client
        .from('trips')
        .select()
        .eq('status', 'active')
        .eq('driver_id', driverId);

    debugPrint('Trips response: $response');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchTripItems(
    String tripDisplayId,
  ) async {
    final driverId = _client.auth.currentUser?.id;
    if (driverId == null) throw Exception('User not authenticated');

    await _verifyTripOwnership(tripDisplayId, driverId);

    final response = await _client
        .from('trip_items')
        .select()
        .eq('trip_display_id', tripDisplayId);

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchTripStops(
    String tripDisplayId,
  ) async {
    final driverId = _client.auth.currentUser?.id;
    if (driverId == null) throw Exception('User not authenticated');

    await _verifyTripOwnership(tripDisplayId, driverId);

    final response = await _client
        .from('trip_stops')
        .select()
        .eq('trip_display_id', tripDisplayId)
        .order('sort_order');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchRouteMapPoints(
    String tripDisplayId,
  ) async {
    final driverId = _client.auth.currentUser?.id;
    if (driverId == null) throw Exception('User not authenticated');

    await _verifyTripOwnership(tripDisplayId, driverId);

    final response = await _client
        .from('route_map_points')
        .select()
        .eq('trip_display_id', tripDisplayId)
        .order('sort_order');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchTrips() async {
    final driverId = _client.auth.currentUser?.id;
    if (driverId == null) throw Exception('User not authenticated');

    final response = await _client
        .from('trips')
        .select()
        .eq('driver_id', driverId)
        .order('trip_date', ascending: false);

    return List<Map<String, dynamic>>.from(response);
  }

  Future<void> markStopCompleted(
    String stopId,
    String tripDisplayId,
  ) async {
    final driverId = _client.auth.currentUser?.id;
    if (driverId == null) throw Exception('User not authenticated');

    await _verifyTripOwnership(tripDisplayId, driverId);

    await _client.from('trip_stops').update({
      'is_completed': true,
      'is_current': false,
    }).eq('id', stopId).eq('trip_display_id', tripDisplayId);

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
          .eq('driver_id', driverId);
    }
  }
}
