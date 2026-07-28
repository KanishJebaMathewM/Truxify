import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/truck_models.dart';
import 'api_client.dart';

class TruckRepository {
  TruckRepository({SupabaseClient? client, ApiClient? apiClient})
      : _client = client ?? Supabase.instance.client,
        _apiClient = apiClient ?? ApiClient();

  static const Set<String> _allowedTicketStatuses = {
    'open',
    'in_progress',
    'resolved',
    'closed',
  };

  final SupabaseClient _client;
  final ApiClient _apiClient;

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

    if (response is! List) {
      throw StateError('Unexpected ticket response type');
    }

    return response
        .map((item) {
          if (item is Map<String, dynamic>) return item;
          if (item is Map) return Map<String, dynamic>.from(item);
          throw StateError('Unexpected ticket item type');
        })
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
    required String driverId,
    required String status,
    String? resolutionNotes,
  }) async {
    final normalizedStatus = status.trim().toLowerCase();
    if (!_allowedTicketStatuses.contains(normalizedStatus)) {
      throw ArgumentError.value(status, 'status', 'unsupported ticket status');
    }

    final update = <String, dynamic>{'status': normalizedStatus};
    if (resolutionNotes != null) update['resolution_notes'] = resolutionNotes;
    if (normalizedStatus == 'resolved' || normalizedStatus == 'closed') {
      update['resolved_at'] = DateTime.now().toIso8601String();
    }
    final response = await _client
        .from('truck_maintenance_tickets')
        .update(update)
        .eq('id', ticketId)
        .eq('driver_id', driverId)
        .select()
        .maybeSingle();
    return response == null ? null : TruckMaintenanceTicket.fromJson(response);
  }

  Future<bool> updateTruckMileage({
    required String truckId,
    required double currentMileage,
  }) async {
    final response = await _client
        .from('trucks')
        .update({'mileage_km': currentMileage, 'updated_at': DateTime.now().toIso8601String()})
        .eq('id', truckId)
        .select('id')
        .maybeSingle();
    return response != null;
  }

  Future<List<Map<String, dynamic>>> fetchTruckDocuments(String truckId) async {
    final response = await _client
        .from('truck_documents')
        .select()
        .eq('truck_id', truckId)
        .order('expires_at', ascending: true);
    if (response is! List) {
      throw StateError('Unexpected truck document response type');
    }
    return response.map((item) {
      if (item is Map<String, dynamic>) return item;
      if (item is Map) return Map<String, dynamic>.from(item);
      throw StateError('Unexpected truck document item type');
    }).toList(growable: false);
  }

  Future<List<String>> uploadMaintenancePhotos({
    required String ticketId,
    required List<MultipartFileInfo> files,
  }) async {
    final result = await _apiClient.postMultipart(
      '/api/maintenance/$ticketId/photos',
      fields: const {},
      files: files,
    );

    if (result is Map<String, dynamic> && result['photo_urls'] is List) {
      return List<String>.from(result['photo_urls'] as List);
    }

    throw StateError('Unexpected response from photo upload');
  }
}
