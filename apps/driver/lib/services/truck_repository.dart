import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/truck_models.dart';

class TruckRepository {
  TruckRepository({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;

  Future<Truck?> fetchTruckForDriver(String driverId) async {
    final response = await _client
        .from('trucks')
        .select()
        .eq('driver_id', driverId)
        .maybeSingle();

    if (response == null) {
      return null;
    }

    return Truck.fromJson(response);
  }

  Future<List<TruckMaintenanceTicket>> fetchMaintenanceTickets(
      String truckId) async {
    final response = await _client
        .from('truck_maintenance_tickets')
        .select()
        .eq('truck_id', truckId)
        .order('created_at', ascending: false);

    return List<Map<String, dynamic>>.from(response)
        .map(TruckMaintenanceTicket.fromJson)
        .toList(growable: false);
  }

  Future<TruckMaintenanceTicket> createMaintenanceTicket({
    required String truckId,
    required String driverId,
    required String category,
    required String description,
  }) async {
    final inserted = await _client
        .from('truck_maintenance_tickets')
        .insert({
          'truck_id': truckId,
          'driver_id': driverId,
          'category': category,
          'description': description,
          'status': 'open',
        })
        .select()
        .single();

    return TruckMaintenanceTicket.fromJson(inserted);
  }
}
