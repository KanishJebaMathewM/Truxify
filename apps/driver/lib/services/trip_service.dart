import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class TripService {
  TripService({SupabaseClient? client}) : _providedClient = client;

  final SupabaseClient? _providedClient;

  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;

  Future<List<Map<String, dynamic>>> fetchActiveTrips() async {
    final response =
        await _client.from('trips').select().eq('status', 'active');

    debugPrint('Trips response: $response');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchTripItems(
    String tripDisplayId,
  ) async {
    final response = await _client
        .from('trip_items')
        .select()
        .eq('trip_display_id', tripDisplayId);

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchTripStops(
    String tripDisplayId,
  ) async {
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
    final response = await _client
        .from('route_map_points')
        .select()
        .eq('trip_display_id', tripDisplayId)
        .order('sort_order');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchTrips() async {
    final response = await _client
        .from('trips')
        .select()
        .order('trip_date', ascending: false);

    return List<Map<String, dynamic>>.from(response);
  }

  Future<void> markStopCompleted(
    String stopId,
    String tripDisplayId,
  ) async {
    await _client.from('trip_stops').update({
      'is_completed': true,
      'is_current': false,
    }).eq('id', stopId);

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
          .update({'is_current': true}).eq('id', nextStops.first['id']);
    } else {
      await _client
          .from('trips')
          .update({'status': 'completed'}).eq('trip_display_id', tripDisplayId);
    }
  }
}
