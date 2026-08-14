import 'dart:async';
import '../models/bridge_strike_prevention_model.dart';

class BridgeStrikePreventionService {
  final _telemetryController = StreamController<RouteClearance>.broadcast();

  Stream<RouteClearance> get telemetryStream => _telemetryController.stream;

  void simulateJourney() async {
    // 1. Driving on a safe highway
    _telemetryController.add(RouteClearance(
      currentSpeedMph: 65.0,
      truckHeightInches: 162.0, // 13'6" standard trailer
      nextHazardName: 'I-95 Overpass',
      hazardClearanceInches: 180.0, // 15' clearance
      distanceToHazardMiles: 4.5,
      isDeviationDetected: false,
      isSafeRouteRecalculating: false,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Driver takes a wrong exit into a residential/historic area
    _telemetryController.add(RouteClearance(
      currentSpeedMph: 45.0,
      truckHeightInches: 162.0,
      nextHazardName: '11ft 8in Bridge (Main St)',
      hazardClearanceInches: 140.0, // 11'8" (too low for 13'6" truck)
      distanceToHazardMiles: 0.8,
      isDeviationDetected: true,
      isSafeRouteRecalculating: true, // Triggering recalculation
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. AI has found a safe detour to bypass the bridge
    _telemetryController.add(RouteClearance(
      currentSpeedMph: 25.0, // Slowed down
      truckHeightInches: 162.0,
      nextHazardName: 'None',
      hazardClearanceInches: 999.0,
      distanceToHazardMiles: 0.0,
      isDeviationDetected: true,
      isSafeRouteRecalculating: false, // Detour generated
    ));
  }

  void dispose() {
    _telemetryController.close();
  }
}
