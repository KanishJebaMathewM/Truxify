import 'dart:async';
import '../models/driver_fatigue_model.dart';

class DriverFatigueService {
  final _sessionController = StreamController<FatigueSession>.broadcast();

  Stream<FatigueSession> get fatigueStream => _sessionController.stream;

  void simulateFatigueTracking() async {
    // 1. Driver is alert
    _sessionController.add(FatigueSession(
      driverId: 'TRX-DRV-9941',
      status: 'Alert & Active',
      fatigueScore: 12.0,
      recommendedAction: 'Continue Driving Safely',
      ocularData: OcularTelemetry(
        blinkRatePerMinute: 15.0,
        averageEyeClosureDurationMs: 120.0,
        headNodAngleDegrees: 2.0,
        microsleepDetected: false,
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Drowsiness setting in
    _sessionController.add(FatigueSession(
      driverId: 'TRX-DRV-9941',
      status: 'Drowsiness Detected (Early Warning)',
      fatigueScore: 65.5,
      recommendedAction: 'Consider taking a break soon.',
      ocularData: OcularTelemetry(
        blinkRatePerMinute: 28.0, // Blinking more frequently
        averageEyeClosureDurationMs: 350.0, // Eyes staying closed longer
        headNodAngleDegrees: 8.5,
        microsleepDetected: false,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Microsleep!
    _sessionController.add(FatigueSession(
      driverId: 'TRX-DRV-9941',
      status: 'CRITICAL - MICROSLEEP ALARM TRIGGERED',
      fatigueScore: 98.0,
      recommendedAction: 'ROUTING TO NEAREST REST AREA (2.4 miles)',
      ocularData: OcularTelemetry(
        blinkRatePerMinute: 5.0,
        averageEyeClosureDurationMs: 1500.0, // Eyes closed for 1.5 seconds!
        headNodAngleDegrees: 25.0, // Head dropped
        microsleepDetected: true,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
