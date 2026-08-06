import 'dart:async';
import '../models/driver_fatigue_model.dart';

class FatigueDetectionService {
  /// Simulates an on-device Edge AI model processing front-facing camera frames
  Stream<FatigueMetrics> startVisionProcessing() async* {
    yield FatigueMetrics(
      eyeClosurePercentage: 0.15,
      blinkRatePerMinute: 15.0,
      headNodsDetected: 0,
      isMicroSleepDetected: false,
      fatigueLevel: 'Awake',
      timestamp: DateTime.now(),
    );

    await Future.delayed(const Duration(seconds: 3));

    yield FatigueMetrics(
      eyeClosurePercentage: 0.60,
      blinkRatePerMinute: 8.0, // Slowed blinking
      headNodsDetected: 1,
      isMicroSleepDetected: false,
      fatigueLevel: 'Drowsy',
      timestamp: DateTime.now(),
    );

    await Future.delayed(const Duration(seconds: 2));

    yield FatigueMetrics(
      eyeClosurePercentage: 0.95, // Eyes essentially closed
      blinkRatePerMinute: 2.0,
      headNodsDetected: 3,
      isMicroSleepDetected: true,
      fatigueLevel: 'Critical',
      timestamp: DateTime.now(),
    );
  }
}
