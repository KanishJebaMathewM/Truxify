import 'dart:async';
import '../models/detention_pay_model.dart';

class GeofenceDetentionService {
  Future<DetentionSession> getCurrentSession() async {
    // Simulate API call to fetch active geofence session
    await Future.delayed(const Duration(seconds: 1));

    // Simulate driver who has been waiting for 4.5 hours (2.5 hours billable)
    return DetentionSession(
      sessionId: 'DET-9921-X',
      facilityName: 'AmeriCold Logistics Distribution Center - Dallas',
      geofenceEntryTime: DateTime.now().subtract(const Duration(hours: 4, minutes: 30)),
      gracePeriodHours: 2,
      hourlyDetentionRate: 65.00,
      isCurrentlyActive: true,
    );
  }
}
