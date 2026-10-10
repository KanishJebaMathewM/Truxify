import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';

class HosService {
  /// Statuses: 'off_duty', 'on_duty', 'driving', 'resting'
  static Future<bool> updateStatus(String status) async {
    try {
      // Use ApiClient to automatically handle token refresh and 401 retries (#14935)
      final response = await ApiClient().put(
        '/api/driver/hos/status',
        body: {'status': status},
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
          .eq('user_id', driverId)
          .maybeSingle();
      
      return response;
    } catch (e) {
      debugPrint('[HosService] Error fetching HoS status: $e');
      return null;
    }
  }
}