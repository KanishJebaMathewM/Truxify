class RoadHazard {
  final String type; // "Severe Pothole", "Debris"
  final String severity; // "Moderate", "Suspension Damage Risk"
  final double distanceAheadMiles;
  final String lane; // "Right Lane", "Center Lane"
  final double impactGForce; // Recorded by the truck that hit it

  RoadHazard({
    required this.type,
    required this.severity,
    required this.distanceAheadMiles,
    required this.lane,
    required this.impactGForce,
  });
}

class HazardMeshSession {
  final String status; // "Cruising I-40 East", "HAZARD AHEAD: MERGE LEFT"
  final bool isHazardActive;
  final int activeNodesInMesh;
  final List<RoadHazard> upcomingHazards;

  HazardMeshSession({
    required this.status,
    required this.isHazardActive,
    required this.activeNodesInMesh,
    required this.upcomingHazards,
  });
}
