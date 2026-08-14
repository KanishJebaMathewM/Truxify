class WeatherRiskProfile {
  final String routeSegment;
  final String historicalWeatherCondition;
  final double averageSummerSpeed;
  final double historicalWinterSpeed;
  final double speedReductionPercentage;
  final double addedTransitTimeHours;
  final String riskLevel; // Low, Medium, High, Severe

  WeatherRiskProfile({
    required this.routeSegment,
    required this.historicalWeatherCondition,
    required this.averageSummerSpeed,
    required this.historicalWinterSpeed,
    required this.speedReductionPercentage,
    required this.addedTransitTimeHours,
    required this.riskLevel,
  });
}

class WeatherAnalyticsSession {
  final String status;
  final String origin;
  final String destination;
  final DateTime targetDeparture;
  final List<WeatherRiskProfile> segmentRisks;
  final double totalAddedTransitHours;
  final bool isAnalyzing;

  WeatherAnalyticsSession({
    required this.status,
    required this.origin,
    required this.destination,
    required this.targetDeparture,
    required this.segmentRisks,
    required this.totalAddedTransitHours,
    required this.isAnalyzing,
  });
}
