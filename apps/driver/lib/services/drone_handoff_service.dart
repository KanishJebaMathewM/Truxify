import 'dart:async';
import '../models/drone_telemetry_model.dart';

class DroneHandoffService {
  final StreamController<DroneTelemetry> _telemetryController = StreamController<DroneTelemetry>.broadcast();

  Stream<DroneTelemetry> get telemetryStream => _telemetryController.stream;

  void startMockMission() {
    int timeToRendezvous = 120;
    double distance = 1500.0; // meters

    Timer.periodic(const Duration(seconds: 1), (timer) {
      if (timeToRendezvous <= 0 || distance <= 0) {
        _telemetryController.add(DroneTelemetry(
          droneId: 'DRN-AeroX-12',
          status: 'Docked',
          distanceToTruck: 0.0,
          predictedRendezvousGps: '41.8781, -87.6298',
          timeToRendezvousSec: 0,
          batteryPercent: 42,
        ));
        timer.cancel();
      } else {
        timeToRendezvous -= 1;
        distance -= 12.5; // Approach speed
        
        _telemetryController.add(DroneTelemetry(
          droneId: 'DRN-AeroX-12',
          status: 'Returning (Mid-Air Intercept)',
          distanceToTruck: distance,
          predictedRendezvousGps: '41.8781, -87.6298',
          timeToRendezvousSec: timeToRendezvous,
          batteryPercent: 45,
        ));
      }
    });
  }

  void dispose() {
    _telemetryController.close();
  }
}
