import 'dart:async';
import '../models/customer_notification_model.dart';

enum TrafficDensity { low, moderate, high }

class GeoNotificationService {
  /// Simulates a cascading geofence that triggers as the truck approaches the facility.
  /// Dynamically expands the arrival geo-fence based on local traffic density 
  /// to ensure the dock prep notification arrives exactly 30 minutes prior to arrival.
  Stream<CustomerNotification> simulateApproachJourney({
    TrafficDensity trafficDensity = TrafficDensity.moderate,
  }) async* {
    final facility = 'Amazon Fulfillment Center (IND8)';
    final loadId = 'LD-81992';

    // Wait to simulate entering the 50-mile perimeter
    await Future.delayed(const Duration(seconds: 3));
    yield CustomerNotification(
      loadId: loadId,
      facilityName: facility,
      triggerEvent: '50_MILES_OUT',
      triggeredAt: DateTime.now(),
      status: 'SENT',
      messageBody: 'Alert: Truxify Driver for load $loadId is approx 50 miles away.',
    );

    // Wait to simulate entering the 30-minute ETA perimeter
    await Future.delayed(const Duration(seconds: 5));
    
    // Dynamic radius calculation based on traffic density
    // To ensure the notification arrives exactly 30 mins prior:
    // High traffic: radius shrinks because it takes 30 mins to go 15 miles.
    // Low traffic: radius expands because it takes 30 mins to go 30 miles.
    int dynamicRadiusMiles;
    switch (trafficDensity) {
      case TrafficDensity.high:
        dynamicRadiusMiles = 15;
        break;
      case TrafficDensity.moderate:
        dynamicRadiusMiles = 25;
        break;
      case TrafficDensity.low:
        dynamicRadiusMiles = 30;
        break;
    }

    yield CustomerNotification(
      loadId: loadId,
      facilityName: facility,
      triggerEvent: '${dynamicRadiusMiles}_MILES_OUT',
      triggeredAt: DateTime.now(),
      status: 'SENT',
      messageBody: 'Alert: Truxify Driver for load $loadId is $dynamicRadiusMiles miles away (30 min ETA). Please prepare dock door.',
    );

    // Wait to simulate final arrival
    await Future.delayed(const Duration(seconds: 5));
    yield CustomerNotification(
      loadId: loadId,
      facilityName: facility,
      triggerEvent: 'ARRIVED',
      triggeredAt: DateTime.now(),
      status: 'SENT',
      messageBody: 'Alert: Driver has arrived at the facility gate.',
    );
  }
}
