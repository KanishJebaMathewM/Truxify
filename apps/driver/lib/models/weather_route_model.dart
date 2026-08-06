class WeatherRouteDeviation {
  final String routeId;
  final String currentPath;
  final String weatherAlert; // e.g. 'Severe Blizzard Ahead'
  final String suggestedDeviationPath;
  final int additionalMiles;
  final int estimatedTimeSavedMinutes;
  final double severityLevel; // 0.0 to 1.0

  WeatherRouteDeviation({
    required this.routeId,
    required this.currentPath,
    required this.weatherAlert,
    required this.suggestedDeviationPath,
    required this.additionalMiles,
    required this.estimatedTimeSavedMinutes,
    required this.severityLevel,
  });
}
