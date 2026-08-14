import 'dart:async';
import '../models/drone_security_model.dart';

class DroneSecurityService {
  final _sessionController = StreamController<DroneSecuritySession>.broadcast();

  Stream<DroneSecuritySession> get securityStream => _sessionController.stream;

  void simulateSecurityPatrol() async {
    // 1. Nominal patrol
    _sessionController.add(DroneSecuritySession(
      status: 'Sentry Deployed - Scanning Perimeter',
      locationRisk: 'High-Crime Cargo Geofence (Memphis, TN)',
      droneAltitudeFeet: 50.0,
      cameraMode: 'FLIR Thermal Night Vision',
      isAlarmActive: false,
      activeThreats: [],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Threat approaching
    _sessionController.add(DroneSecuritySession(
      status: 'MOTION DETECTED: TRACKING THERMAL SIGNATURE',
      locationRisk: 'High-Crime Cargo Geofence (Memphis, TN)',
      droneAltitudeFeet: 50.0,
      cameraMode: 'FLIR Thermal Night Vision',
      isAlarmActive: false,
      activeThreats: [
        SecurityThreat(detectionTime: DateTime.now(), objectType: 'Human Signature', distanceToTrailerFeet: 45.0, threatLevel: 'Elevated'),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Threat critical, alarm active
    _sessionController.add(DroneSecuritySession(
      status: 'CRITICAL THREAT: REAR DOORS BREACHED',
      locationRisk: 'High-Crime Cargo Geofence (Memphis, TN)',
      droneAltitudeFeet: 50.0,
      cameraMode: 'High-Res Optical Tracking', // Switched from FLIR to record face
      isAlarmActive: true,
      activeThreats: [
        SecurityThreat(detectionTime: DateTime.now(), objectType: 'Human Signature', distanceToTrailerFeet: 2.0, threatLevel: 'Critical'),
        SecurityThreat(detectionTime: DateTime.now(), objectType: 'Unidentified Vehicle', distanceToTrailerFeet: 15.0, threatLevel: 'Critical'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
