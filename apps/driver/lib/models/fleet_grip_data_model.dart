class GripReport {
  final String highwaySegment;
  final double distanceAheadMiles;
  final double roadGripIndex; // 0.0 to 10.0 (10 is perfect grip, 0 is sheer ice)
  final int activeSlipEventsDetected;
  final int reportingTrucks;
  final String status; // "Clear", "Slush", "Black Ice", "Chain Up Required"

  GripReport({
    required this.highwaySegment,
    required this.distanceAheadMiles,
    required this.roadGripIndex,
    required this.activeSlipEventsDetected,
    required this.reportingTrucks,
    required this.status,
  });
}

class FleetGripNetwork {
  final double currentGripIndex;
  final String currentStatus;
  final List<GripReport> upcomingReports;
  final bool requiresChains;

  FleetGripNetwork({
    required this.currentGripIndex,
    required this.currentStatus,
    required this.upcomingReports,
    required this.requiresChains,
  });
}
