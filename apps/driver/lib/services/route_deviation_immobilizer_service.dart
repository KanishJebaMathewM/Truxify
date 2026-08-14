import 'dart:async';
import '../models/route_deviation_immobilizer_model.dart';

class RouteDeviationImmobilizerService {
  final _telemetryController = StreamController<RouteDeviationStatus>.broadcast();

  Stream<RouteDeviationStatus> get deviationStream => _telemetryController.stream;

  void simulateHijackingAttempt() async {
    // 1. Secure routing
    _telemetryController.add(RouteDeviationStatus(
      isHighValueCargo: true,
      cargoType: 'Schedule II Pharmaceuticals',
      allowedDeviationMiles: 2.0,
      currentDeviationMiles: 0.1,
      status: 'Secure',
      message: 'On Approved Route.',
      speedLimitMph: 75,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Warning - off route
    _telemetryController.add(RouteDeviationStatus(
      isHighValueCargo: true,
      cargoType: 'Schedule II Pharmaceuticals',
      allowedDeviationMiles: 2.0,
      currentDeviationMiles: 2.5,
      status: 'Warning',
      message: 'Route Deviation Detected. Return to authorized corridor immediately.',
      speedLimitMph: 75,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Immobilization triggered (hijacking suspected)
    _telemetryController.add(RouteDeviationStatus(
      isHighValueCargo: true,
      cargoType: 'Schedule II Pharmaceuticals',
      allowedDeviationMiles: 2.0,
      currentDeviationMiles: 5.2,
      status: 'Immobilized',
      message: 'CRITICAL DEVIATION. ECM De-rate engaged. Authorities dispatched.',
      speedLimitMph: 5, // Limp mode
    ));
  }

  void dispose() {
    _telemetryController.close();
  }
}
