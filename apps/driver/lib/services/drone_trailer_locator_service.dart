import 'dart:async';
import '../models/drone_trailer_locator_model.dart';

class DroneTrailerLocatorService {
  final _sessionController = StreamController<DroneSession>.broadcast();

  Stream<DroneSession> get droneStream => _sessionController.stream;

  void deployDrone(String targetId) async {
    // 1. Deployment
    _sessionController.add(DroneSession(
      status: 'Deploying Yard Drone...',
      isAirborne: true,
      trailersScanned: 0,
      targetTrailer: null,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Scanning Grid
    _sessionController.add(DroneSession(
      status: 'Flying Autonomous Grid Search...',
      isAirborne: true,
      trailersScanned: 14,
      targetTrailer: null,
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Trailer Found
    _sessionController.add(DroneSession(
      status: 'TRAILER LOCATED. PIN DROPPED.',
      isAirborne: false, // Drone returns
      trailersScanned: 42,
      targetTrailer: TrailerLocation(
        trailerId: targetId,
        yardZone: 'Row G, Slot 112',
        distanceFeet: 850.0,
        isFound: true,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
