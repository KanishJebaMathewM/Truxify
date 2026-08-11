import 'dart:async';
import '../models/cargo_shift_detection_model.dart';

class CargoShiftDetectionService {
  final _sensorController = StreamController<SuspensionTelemetry>.broadcast();

  Stream<SuspensionTelemetry> get sensorStream => _sensorController.stream;

  void simulateCargoShift() async {
    // 1. Stable Highway Driving
    _sensorController.add(SuspensionTelemetry(
      lateralGForce: 0.05,
      leftAirbagPsi: 55.0,
      rightAirbagPsi: 55.2,
      weightDistributionDeltaPct: 0.3,
      status: 'Stable',
      systemMessage: 'Load is balanced and secure.',
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Hard Braking / Swerve event
    _sensorController.add(SuspensionTelemetry(
      lateralGForce: 0.85, // Sharp corner or swerve
      leftAirbagPsi: 70.0,
      rightAirbagPsi: 40.0,
      weightDistributionDeltaPct: 25.0, // High variance during maneuver
      status: 'Warning',
      systemMessage: 'High lateral G-force detected. Monitoring suspension settling...',
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Cargo Shift Detected (Pallet tipped over) - Physics signature persists after maneuver
    _sensorController.add(SuspensionTelemetry(
      lateralGForce: 0.02, // Driving straight again
      leftAirbagPsi: 68.0, // But left side remains heavily loaded
      rightAirbagPsi: 42.0, // Right side remains light
      weightDistributionDeltaPct: 22.5, // Permanent shift
      status: 'Critical Shift',
      systemMessage: 'CARGO SHIFT DETECTED! Pull over immediately to inspect and secure freight.',
    ));
  }

  void dispose() {
    _sensorController.close();
  }
}
