class RouteClearance {
  final double currentSpeedMph;
  final double truckHeightInches;
  final String nextHazardName;
  final double hazardClearanceInches;
  final double distanceToHazardMiles;
  final bool isDeviationDetected;
  final bool isSafeRouteRecalculating;

  RouteClearance({
    required this.currentSpeedMph,
    required this.truckHeightInches,
    required this.nextHazardName,
    required this.hazardClearanceInches,
    required this.distanceToHazardMiles,
    required this.isDeviationDetected,
    required this.isSafeRouteRecalculating,
  });
}
