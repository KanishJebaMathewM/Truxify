class RouteTopology {
  final String terrainType; // e.g. "Flat", "Mountainous", "Urban"
  final double distanceMiles;
  final double maxGradePct;
  final double averageGradePct;

  RouteTopology({
    required this.terrainType,
    required this.distanceMiles,
    required this.maxGradePct,
    required this.averageGradePct,
  });
}

class EcmTuneProfile {
  final String profileId;
  final String profileName; // e.g. "Eco Cruise", "Max Torque Climb"
  final double peakTorqueLbFt;
  final int shiftPointRpm;
  final bool isApplied;
  final RouteTopology upcomingTopology;

  EcmTuneProfile({
    required this.profileId,
    required this.profileName,
    required this.peakTorqueLbFt,
    required this.shiftPointRpm,
    required this.isApplied,
    required this.upcomingTopology,
  });
}
