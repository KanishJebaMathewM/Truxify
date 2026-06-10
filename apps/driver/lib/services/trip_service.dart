import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/driver_session.dart';

class TripService {
  TripService({SupabaseClient? client}) : _providedClient = client;

  final SupabaseClient? _providedClient;

  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;

  String get _driverId {
    final id = DriverSession.driverId;
    if (id.isEmpty) throw Exception('Driver session not initialised');
    return id;
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
    var query = _client.from('trips').select().eq('driver_id', _driverId);

    if (status != null) {
      query = query.eq('status', status);
    }

    final response = await query.order('trip_date', ascending: false);

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchTripItems(
    String tripDisplayId,
  ) async {
    await _verifyTripOwnership(tripDisplayId);

    final response = await _client
        .from('trip_items')
        .select()
        .eq('trip_display_id', tripDisplayId);

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchTripStops(
    String tripDisplayId,
  ) async {
    await _verifyTripOwnership(tripDisplayId);

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
    await _verifyTripOwnership(tripDisplayId);

    final response = await _client
        .from('route_map_points')
        .select()
        .eq('trip_display_id', tripDisplayId)
        .order('sort_order');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<void> markStopCompleted(
    String stopId,
    String tripDisplayId,
  ) async {
    await _verifyTripOwnership(tripDisplayId);

    await _client
        .from('trip_stops')
        .update({
          'is_completed': true,
          'is_current': false,
        })
        .eq('id', stopId)
        .eq('trip_display_id', tripDisplayId);

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
}
