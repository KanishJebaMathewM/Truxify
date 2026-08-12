import 'dart:async';
import '../models/docking_assist_model.dart';

class DockingAssistService {
  final _sessionController = StreamController<DockingAssistSession>.broadcast();

  Stream<DockingAssistSession> get dockingStream => _sessionController.stream;

  void simulateDockingManeuver() async {
    // 1. Setup Phase
    _sessionController.add(DockingAssistSession(
      status: 'Setup 90-Degree Backing Angle',
      dockNumber: 'DOCK #42 (Walmart DC)',
      isDocked: false,
      geometry: DockingGeometry(
        distanceToDockFeet: 65.0,
        trailerAngleDegrees: 85.0, // Perpendicular to dock
        requiredSteeringWheelAngle: -90.0, // Hard Left
        currentSteeringWheelAngle: 0.0,
        isAligned: false,
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Chasing the trailer (Correcting)
    _sessionController.add(DockingAssistSession(
      status: 'Chase the Trailer - Turn Right',
      dockNumber: 'DOCK #42 (Walmart DC)',
      isDocked: false,
      geometry: DockingGeometry(
        distanceToDockFeet: 30.0,
        trailerAngleDegrees: 45.0, // Sweeping into the spot
        requiredSteeringWheelAngle: 180.0, // Hard Right to chase
        currentSteeringWheelAngle: 175.0,
        isAligned: true,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Final straight line back
    _sessionController.add(DockingAssistSession(
      status: 'Straight Back - Do Not Turn',
      dockNumber: 'DOCK #42 (Walmart DC)',
      isDocked: false,
      geometry: DockingGeometry(
        distanceToDockFeet: 10.0,
        trailerAngleDegrees: 0.0, // Perfectly straight
        requiredSteeringWheelAngle: 0.0,
        currentSteeringWheelAngle: 0.0,
        isAligned: true,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 3));
    
    // 4. Docked
    _sessionController.add(DockingAssistSession(
      status: 'SUCCESSFULLY DOCKED',
      dockNumber: 'DOCK #42 (Walmart DC)',
      isDocked: true,
      geometry: DockingGeometry(
        distanceToDockFeet: 0.0,
        trailerAngleDegrees: 0.0,
        requiredSteeringWheelAngle: 0.0,
        currentSteeringWheelAngle: 0.0,
        isAligned: true,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
