import 'dart:async';
import '../models/automated_reefer_precool_model.dart';

class AutomatedReeferPrecoolService {
  final _telemetryController = StreamController<ReeferTelemetry>.broadcast();

  Stream<ReeferTelemetry> get telemetryStream => _telemetryController.stream;

  void simulateJourney() async {
    // 1. Driving, 2 hours away. High ambient temp, trailer is warm.
    _telemetryController.add(ReeferTelemetry(
      currentInternalTempF: 78.5,
      targetLoadTempF: -10.0, // Frozen load
      ambientOutsideTempF: 102.0,
      coolingMode: 'Off',
      estimatedTimeToTargetMinutes: 0.0,
      isReadyForPickup: false,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Telematics detect ETA is 120 mins. Ambient is 102F. 
    // AI triggers aggressive pre-cool automatically.
    _telemetryController.add(ReeferTelemetry(
      currentInternalTempF: 78.5,
      targetLoadTempF: -10.0,
      ambientOutsideTempF: 102.0,
      coolingMode: 'Aggressive Pre-cool',
      estimatedTimeToTargetMinutes: 45.0,
      isReadyForPickup: false,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Approaching shipper. Temp achieved.
    _telemetryController.add(ReeferTelemetry(
      currentInternalTempF: -10.5,
      targetLoadTempF: -10.0,
      ambientOutsideTempF: 101.5,
      coolingMode: 'Maintain (Eco)',
      estimatedTimeToTargetMinutes: 0.0,
      isReadyForPickup: true,
    ));
  }

  void dispose() {
    _telemetryController.close();
  }
}
