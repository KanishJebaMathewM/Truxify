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
        .eq('owner_id', driverId)
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

  Future<TruckMaintenanceTicket?> updateTicketStatus({
    required int ticketId,
    required String status,
    String? resolutionNotes,
  }) async {
    final update = <String, dynamic>{'status': status};
    if (resolutionNotes != null) update['resolution_notes'] = resolutionNotes;
    if (status == 'resolved' || status == 'closed') {
      update['resolved_at'] = DateTime.now().toIso8601String();
    }
    final response = await _client
        .from('truck_maintenance_tickets')
        .update(update)
        .eq('id', ticketId)
        .select()
        .single();
    return TruckMaintenanceTicket.fromJson(response);
  }

  Future<bool> updateTruckMileage({
    required String truckId,
    required double currentMileage,
  }) async {
    final response = await _client
        .from('trucks')
        .update({'mileage_km': currentMileage, 'updated_at': DateTime.now().toIso8601String()})
        .eq('id', truckId);
    return response > 0;
  }

  Future<List<Map<String, dynamic>>> fetchTruckDocuments(String truckId) async {
    final response = await _client
        .from('truck_documents')
        .select()
        .eq('truck_id', truckId)
        .order('expires_at', ascending: true);
    return List<Map<String, dynamic>>.from(response);
  }
}
