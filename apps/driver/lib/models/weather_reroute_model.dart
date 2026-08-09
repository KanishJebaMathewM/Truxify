class WeatherHazard {
  final String hazardId;
  final String hazardType; // e.g. 'BLIZZARD', 'FLOOD', 'ACCIDENT_CLOSURE'
  final String severity; // 'WARNING', 'CRITICAL'
  final String description;
  final double milesAhead;

  WeatherHazard({
    required this.hazardId,
    required this.hazardType,
    required this.severity,
    required this.description,
    required this.milesAhead,
  });
}

class RerouteSuggestion {
  final String routeId;
  final WeatherHazard avoidedHazard;
  final double addedDistanceMiles;
  final double timeImpactMinutes; // Can be negative if it saves time
  final String polylineEncoded;

  RerouteSuggestion({
    required this.routeId,
    required this.avoidedHazard,
    required this.addedDistanceMiles,
    required this.timeImpactMinutes,
    required this.polylineEncoded,
  });
}
