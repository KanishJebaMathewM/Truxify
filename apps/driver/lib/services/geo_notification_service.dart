import 'dart:async';
import '../models/customer_notification_model.dart';

class GeoNotificationService {
  /// Simulates a cascading geofence that triggers as the truck approaches the facility.
  Stream<CustomerNotification> simulateApproachJourney() async* {
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

    // Wait to simulate entering the 10-mile perimeter
    await Future.delayed(const Duration(seconds: 5));
    yield CustomerNotification(
      loadId: loadId,
      facilityName: facility,
      triggerEvent: '10_MILES_OUT',
      triggeredAt: DateTime.now(),
      status: 'SENT',
      messageBody: 'Alert: Truxify Driver for load $loadId is 10 miles away. Please prepare dock door.',
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
