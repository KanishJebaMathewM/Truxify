import 'dart:async';
import '../models/v2x_traffic_preemption_model.dart';

class V2XTrafficPreemptionService {
  final _telemetryController = StreamController<V2XPreemptionStatus>.broadcast();

  Stream<V2XPreemptionStatus> get v2xStream => _telemetryController.stream;

  void simulateApproach() async {
    // 1. Cruising, approaching intersection
    _telemetryController.add(V2XPreemptionStatus(
      isV2XActive: true,
      vehicleWeightLbs: 79500.0,
      currentSpeedMph: 45.0,
      upcomingIntersection: TrafficIntersection(
        intersectionId: 'INT-4491',
        name: 'Main St & 4th Ave',
        distanceFeet: 1200.0,
        currentLightState: 'Green',
        secondsUntilChange: 4, // Will turn yellow before truck arrives
      ),
      isPreemptionRequested: false,
      isPreemptionGranted: false,
      message: 'Approaching intersection.',
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. AI detects stale green, requests preemption to avoid 80,000lb hard brake
    _telemetryController.add(V2XPreemptionStatus(
      isV2XActive: true,
      vehicleWeightLbs: 79500.0,
      currentSpeedMph: 45.0,
      upcomingIntersection: TrafficIntersection(
        intersectionId: 'INT-4491',
        name: 'Main St & 4th Ave',
        distanceFeet: 600.0,
        currentLightState: 'Green',
        secondsUntilChange: 1, // About to change!
      ),
      isPreemptionRequested: true,
      isPreemptionGranted: false,
      message: 'Stale green detected. Requesting V2X green extension...',
    ));

    await Future.delayed(const Duration(seconds: 2));

    // 3. City grid grants preemption, extending green by 5 seconds
    _telemetryController.add(V2XPreemptionStatus(
      isV2XActive: true,
      vehicleWeightLbs: 79500.0,
      currentSpeedMph: 45.0,
      upcomingIntersection: TrafficIntersection(
        intersectionId: 'INT-4491',
        name: 'Main St & 4th Ave',
        distanceFeet: 200.0,
        currentLightState: 'Green',
        secondsUntilChange: 6, // Extended!
      ),
      isPreemptionRequested: true,
      isPreemptionGranted: true,
      message: 'V2X Preemption GRANTED. Green light extended +5s.',
    ));
    
    await Future.delayed(const Duration(seconds: 4));
    
    // 4. Cleared
    _telemetryController.add(V2XPreemptionStatus(
      isV2XActive: true,
      vehicleWeightLbs: 79500.0,
      currentSpeedMph: 45.0,
      upcomingIntersection: null,
      isPreemptionRequested: false,
      isPreemptionGranted: false,
      message: 'Intersection cleared. Returning to normal telemetry.',
    ));
  }

  void dispose() {
    _telemetryController.close();
  }
}
