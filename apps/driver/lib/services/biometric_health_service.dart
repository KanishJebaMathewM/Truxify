import 'dart:async';
import '../models/biometric_health_model.dart';

class BiometricHealthService {
  final _sessionController = StreamController<HealthSession>.broadcast();

  Stream<HealthSession> get healthStream => _sessionController.stream;

  void simulateMedicalEmergency() async {
    // 1. Normal State
    _sessionController.add(HealthSession(
      status: 'Steering Wheel Sensors Active',
      isEmergencyActive: false,
      isAutonomousPullOverActive: false,
      is911Dispatched: false,
      biometrics: BiometricData(
        heartRateBpm: 72,
        hrvMs: 65.5,
        ecgRhythm: 'Normal Sinus Rhythm',
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Early Warning / Arrhythmia
    _sessionController.add(HealthSession(
      status: 'WARNING: CARDIAC ARRHYTHMIA DETECTED',
      isEmergencyActive: true, // Soft alarm
      isAutonomousPullOverActive: false,
      is911Dispatched: false,
      biometrics: BiometricData(
        heartRateBpm: 135,
        hrvMs: 22.0, // Dropping fast
        ecgRhythm: 'Frequent PVCs',
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Full Cardiac Emergency
    _sessionController.add(HealthSession(
      status: 'MEDICAL EMERGENCY: AUTONOMOUS INTERVENTION',
      isEmergencyActive: true,
      isAutonomousPullOverActive: true, // AEB taking over
      is911Dispatched: true, // Calling EMS
      biometrics: BiometricData(
        heartRateBpm: 210,
        hrvMs: 12.0,
        ecgRhythm: 'Ventricular Tachycardia (V-Tach)', // Critical
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
