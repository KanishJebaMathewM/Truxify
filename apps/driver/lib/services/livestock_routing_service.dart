import 'dart:async';
import '../models/livestock_routing_model.dart';

class LivestockRoutingService {
  final _telemetryController = StreamController<LivestockTelemetry>.broadcast();

  Stream<LivestockTelemetry> get routingStream => _telemetryController.stream;

  void simulateHeatStressReroute() async {
    // 1. Initial State - Driving normally
    _telemetryController.add(LivestockTelemetry(
      livestockType: 'Feeder Cattle',
      headCount: 65,
      criticalThi: 84.0, // THI > 84 is danger for cattle
      currentThi: 81.5,
      isAirflowCritical: false,
      activeRoute: [
        LivestockRouteSegment(highwayName: 'I-40 East (Current)', lengthMiles: 15.0, ambientTempF: 92.0, humidityPct: 45.0, expectedSpeedMph: 70.0, status: 'Clear'),
        LivestockRouteSegment(highwayName: 'I-44 North', lengthMiles: 50.0, ambientTempF: 94.0, humidityPct: 42.0, expectedSpeedMph: 68.0, status: 'Clear'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Warning - Traffic jam detected ahead, airflow will stop in extreme heat
    _telemetryController.add(LivestockTelemetry(
      livestockType: 'Feeder Cattle',
      headCount: 65,
      criticalThi: 84.0,
      currentThi: 86.2, // THI spiked due to lack of airflow prediction
      isAirflowCritical: true,
      activeRoute: [
        LivestockRouteSegment(highwayName: 'I-40 East (Current)', lengthMiles: 5.0, ambientTempF: 95.0, humidityPct: 48.0, expectedSpeedMph: 65.0, status: 'Clear'),
        LivestockRouteSegment(highwayName: 'I-44 North', lengthMiles: 50.0, ambientTempF: 98.0, humidityPct: 50.0, expectedSpeedMph: 5.0, status: 'Congested - Rerouting'), // Dead stop!
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Rerouted - Taking rural highways to maintain speed/airflow
    _telemetryController.add(LivestockTelemetry(
      livestockType: 'Feeder Cattle',
      headCount: 65,
      criticalThi: 84.0,
      currentThi: 80.1, // Recovered
      isAirflowCritical: false,
      activeRoute: [
        LivestockRouteSegment(highwayName: 'US-66 East (Detour)', lengthMiles: 45.0, ambientTempF: 91.0, humidityPct: 40.0, expectedSpeedMph: 60.0, status: 'Clear - Airflow Maintained'),
      ],
    ));
  }

  void dispose() {
    _telemetryController.close();
  }
}
