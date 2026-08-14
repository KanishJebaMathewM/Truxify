class LivestockRouteSegment {
  final String highwayName;
  final double lengthMiles;
  final double ambientTempF;
  final double humidityPct;
  final double expectedSpeedMph;
  final String status; // "Clear", "Congested - Rerouting"

  LivestockRouteSegment({
    required this.highwayName,
    required this.lengthMiles,
    required this.ambientTempF,
    required this.humidityPct,
    required this.expectedSpeedMph,
    required this.status,
  });
}

class LivestockTelemetry {
  final String livestockType;
  final int headCount;
  final double criticalThi; // Temperature-Humidity Index danger threshold
  final double currentThi;
  final bool isAirflowCritical;
  final List<LivestockRouteSegment> activeRoute;

  LivestockTelemetry({
    required this.livestockType,
    required this.headCount,
    required this.criticalThi,
    required this.currentThi,
    required this.isAirflowCritical,
    required this.activeRoute,
  });
}
