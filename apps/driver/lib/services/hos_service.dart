import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

class HosService {
  static const String _defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  /// Statuses: 'off_duty', 'on_duty', 'driving', 'resting'
  static Future<bool> updateStatus(String status) async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      final token = session?.accessToken;
      if (token == null) return false;

      final url = Uri.parse('$_defaultApiBaseUrl/api/drivers/hos/status');
      final response = await http.put(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'status': status}),
      );

      if (response.statusCode >= 200 && response.statusCode < 300) {
        debugPrint('[HosService] Successfully updated HoS status to $status');
        return true;
      } else {
        debugPrint('[HosService] Failed to update HoS status. Status code: ${response.statusCode}');
        return false;
      }
    } catch (e) {
      debugPrint('[HosService] Exception updating HoS status: $e');
      return false;
    }
  }

  static Future<Map<String, dynamic>?> fetchCurrentStatus() async {
    try {
      final driverId = Supabase.instance.client.auth.currentUser?.id;
      if (driverId == null) return null;

      final response = await Supabase.instance.client
          .from('driver_details')
          .select('hos_status, accumulated_driving_minutes, accumulated_on_duty_minutes, shift_start_time')
          .eq('driver_id', driverId)
          .maybeSingle();
      
      return response;
    } catch (e) {
      debugPrint('[HosService] Error fetching HoS status: $e');
      return null;
    }
  }
}
