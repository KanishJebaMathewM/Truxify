class RestStop {
  final String stopName;
  final String highwayLocation;
  final int distanceMiles;
  final int estimatedArrivalMinutes;
  final int totalCapacity;
  final int estimatedCurrentOccupancy;
  final double probabilityScore;
  final String status; // 'High Chance', 'Risky', 'Likely Full'

  RestStop({
    required this.stopName,
    required this.highwayLocation,
    required this.distanceMiles,
    required this.estimatedArrivalMinutes,
    required this.totalCapacity,
    required this.estimatedCurrentOccupancy,
    required this.probabilityScore,
    required this.status,
  });
}

class ParkingEngineSession {
  final String status;
  final String currentRoute;
  final DateTime targetShutdownTime;
  final List<RestStop> upcomingStops;
  final bool isAnalyzing;

  ParkingEngineSession({
    required this.status,
    required this.currentRoute,
    required this.targetShutdownTime,
    required this.upcomingStops,
    required this.isAnalyzing,
  });
}
