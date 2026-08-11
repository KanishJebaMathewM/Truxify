class TrailerLocation {
  final String trailerId;
  final String yardZone; // "Row D, Slot 42"
  final double distanceFeet;
  final bool isFound;

  TrailerLocation({
    required this.trailerId,
    required this.yardZone,
    required this.distanceFeet,
    required this.isFound,
  });
}

class DroneSession {
  final String status; // "Deploying Drone...", "Scanning Yard...", "Trailer Found"
  final bool isAirborne;
  final int trailersScanned;
  final TrailerLocation? targetTrailer;

  DroneSession({
    required this.status,
    required this.isAirborne,
    required this.trailersScanned,
    this.targetTrailer,
  });
}
