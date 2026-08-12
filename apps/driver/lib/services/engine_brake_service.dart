import 'dart:async';
import '../models/engine_brake_model.dart';

class EngineBrakeService {
  final _sessionController = StreamController<EngineBrakeSession>.broadcast();

  Stream<EngineBrakeSession> get brakeStream => _sessionController.stream;

  void simulateGeofenceTransition() async {
    // 1. Open Highway
    _sessionController.add(EngineBrakeSession(
      status: 'Engine Brake Active',
      location: 'I-70 Westbound (Open Highway)',
      isRestrictedZone: false,
      isEngineBrakeActive: true,
      fineAvoidedUsd: 0,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Entering Denver City Limits
    _sessionController.add(EngineBrakeSession(
      status: 'Municipal Ordinance Geofence Detected',
      location: 'Approaching Denver City Limits',
      isRestrictedZone: true,
      isEngineBrakeActive: true, // Still active for a second
      fineAvoidedUsd: 0,
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. ECM Override
    _sessionController.add(EngineBrakeSession(
      status: 'ECM OVERRIDE: JAKE BRAKE DISABLED',
      location: 'City of Denver, CO',
      isRestrictedZone: true,
      isEngineBrakeActive: false, // Disabled via ECM
      fineAvoidedUsd: 500, // Denver fine is $500
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
