import 'dart:async';
import '../models/hazard_mesh_model.dart';

class HazardMeshService {
  final _sessionController = StreamController<HazardMeshSession>.broadcast();

  Stream<HazardMeshSession> get meshStream => _sessionController.stream;

  void simulateHazardApproach() async {
    // 1. Cruising, clear road
    _sessionController.add(HazardMeshSession(
      status: 'Mesh Active: Scanning for Hazards...',
      isHazardActive: false,
      activeNodesInMesh: 42, // Other trucks on the road
      upcomingHazards: [],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Another truck 1 mile ahead hits a crater
    _sessionController.add(HazardMeshSession(
      status: 'HAZARD DETECTED AHEAD: MERGE LEFT',
      isHazardActive: true,
      activeNodesInMesh: 42,
      upcomingHazards: [
        RoadHazard(
          type: 'Severe Pothole (Crater)', 
          severity: 'Suspension Damage Risk', 
          distanceAheadMiles: 1.2, 
          lane: 'Right Lane', 
          impactGForce: 3.8 // Huge spike
        ),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Closing in
    _sessionController.add(HazardMeshSession(
      status: 'IMMINENT HAZARD: STAY LEFT',
      isHazardActive: true,
      activeNodesInMesh: 42,
      upcomingHazards: [
        RoadHazard(
          type: 'Severe Pothole (Crater)', 
          severity: 'Suspension Damage Risk', 
          distanceAheadMiles: 0.2, 
          lane: 'Right Lane', 
          impactGForce: 3.8
        ),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
