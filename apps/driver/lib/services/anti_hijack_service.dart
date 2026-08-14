import 'dart:async';
import '../models/anti_hijack_model.dart';

class AntiHijackService {
  final _sessionController = StreamController<AntiHijackSession>.broadcast();

  Stream<AntiHijackSession> get securityStream => _sessionController.stream;

  void simulateHijackAttempt() async {
    // 1. Driver asleep at truck stop
    _sessionController.add(AntiHijackSession(
      loadId: 'HIGH-VALUE-PHARMA-991',
      cargoType: 'Schedule II Pharmaceuticals',
      status: 'Secured at Truck Stop Geofence',
      telemetry: SecurityTelemetry(
        engineStarted: false,
        geofenceBreached: false,
        isDriverAuthorized: false,
        trailerBrakeStatus: 'Air Dumped (Locked)', // Normally locked when parked
        kingpinStatus: 'Unlocked',
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Thief hotwires truck / unauthorized start
    _sessionController.add(AntiHijackSession(
      loadId: 'HIGH-VALUE-PHARMA-991',
      cargoType: 'Schedule II Pharmaceuticals',
      status: 'Unauthorized Engine Start Detected',
      telemetry: SecurityTelemetry(
        engineStarted: true,
        geofenceBreached: false, // hasn't moved yet
        isDriverAuthorized: false, // Biometrics failed/bypassed
        trailerBrakeStatus: 'Pressurizing...', // Thief trying to air up brakes
        kingpinStatus: 'Unlocked',
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Thief tries to drive away, geofence breaches, physical immobilizers activate
    _sessionController.add(AntiHijackSession(
      loadId: 'HIGH-VALUE-PHARMA-991',
      cargoType: 'Schedule II Pharmaceuticals',
      status: 'HIJACKING DETECTED - TRAILER IMMOBILIZED',
      telemetry: SecurityTelemetry(
        engineStarted: true,
        geofenceBreached: true,
        isDriverAuthorized: false,
        trailerBrakeStatus: 'Air Dumped (Locked) - OVERRIDE', // App dumps the air
        kingpinStatus: 'Deadbolt Engaged', // Physically locks trailer to truck or ground
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
