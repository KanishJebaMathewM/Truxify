import 'dart:async';
import '../models/acoustic_brake_model.dart';

class AcousticBrakeService {
  final _sessionController = StreamController<AcousticBrakeSession>.broadcast();

  Stream<AcousticBrakeSession> get brakeStream => _sessionController.stream;

  void simulateBrakingEvent() async {
    // 1. Cruising, not braking
    _sessionController.add(AcousticBrakeSession(
      status: 'Monitoring Ambient Acoustics...',
      currentSpeedMph: 65.0,
      isBraking: false,
      averageThicknessMm: 12.5,
      wheelStatuses: [
        WheelBrakeStatus(position: 'Steer Axle (Front)', estimatedThicknessMm: 14.2, acousticSignature: 'Idle', healthStatus: 'Healthy'),
        WheelBrakeStatus(position: 'Drive Axle (Rear)', estimatedThicknessMm: 11.5, acousticSignature: 'Idle', healthStatus: 'Healthy'),
        WheelBrakeStatus(position: 'Trailer Axles', estimatedThicknessMm: 4.5, acousticSignature: 'Idle', healthStatus: 'Warning'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Hard Braking
    _sessionController.add(AcousticBrakeSession(
      status: 'BRAKING EVENT: ANALYZING ULTRASONIC FREQUENCIES...',
      currentSpeedMph: 45.0,
      isBraking: true,
      averageThicknessMm: 12.5,
      wheelStatuses: [
        WheelBrakeStatus(position: 'Steer Axle (Front)', estimatedThicknessMm: 14.2, acousticSignature: 'Low-Frequency Rumble (Nominal)', healthStatus: 'Healthy'),
        WheelBrakeStatus(position: 'Drive Axle (Rear)', estimatedThicknessMm: 11.5, acousticSignature: 'Mid-Frequency Sweep (Nominal)', healthStatus: 'Healthy'),
        WheelBrakeStatus(position: 'Trailer Axles', estimatedThicknessMm: 3.2, acousticSignature: 'HIGH-PITCH METAL SQUEAL DETECTED', healthStatus: 'Critical'),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Diagnostics Complete
    _sessionController.add(AcousticBrakeSession(
      status: 'DIAGNOSTIC COMPLETE: MAINTENANCE REQUIRED',
      currentSpeedMph: 0.0,
      isBraking: false,
      averageThicknessMm: 9.6,
      wheelStatuses: [
        WheelBrakeStatus(position: 'Steer Axle (Front)', estimatedThicknessMm: 14.2, acousticSignature: 'Logged: Nominal', healthStatus: 'Healthy'),
        WheelBrakeStatus(position: 'Drive Axle (Rear)', estimatedThicknessMm: 11.5, acousticSignature: 'Logged: Nominal', healthStatus: 'Healthy'),
        WheelBrakeStatus(position: 'Trailer Axles', estimatedThicknessMm: 3.2, acousticSignature: 'Logged: Metal-on-Metal Warning', healthStatus: 'Critical'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
