class DailyRateForecast {
  final DateTime date;
  final double predictedRatePerMile;
  final String trend; // 'Up', 'Down', 'Stable'
  final double confidenceIntervalHigh;
  final double confidenceIntervalLow;

  DailyRateForecast({
    required this.date,
    required this.predictedRatePerMile,
    required this.trend,
    required this.confidenceIntervalHigh,
    required this.confidenceIntervalLow,
  });
}

class FreightLaneForecast {
  final String origin;
  final String destination;
  final double currentLoadToTruckRatio;
  final List<DailyRateForecast> sevenDayForecast;
  final String marketCondition; // 'Tight', 'Balanced', 'Soft'

  FreightLaneForecast({
    required this.origin,
    required this.destination,
    required this.currentLoadToTruckRatio,
    required this.sevenDayForecast,
    required this.marketCondition,
  });
}
