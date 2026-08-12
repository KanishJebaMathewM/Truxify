class TireAnalytics {
  final String tirePosition; // e.g., 'Front Left (Steer)', 'Drive Axle 1 Right'
  final int currentPressurePsi;
  final int currentTempF;
  final double estimatedTreadDepthMm;
  final double blowoutRiskPercentage;
  final String recommendation;
  final bool isCritical;

  TireAnalytics({
    required this.tirePosition,
    required this.currentPressurePsi,
    required this.currentTempF,
    required this.estimatedTreadDepthMm,
    required this.blowoutRiskPercentage,
    required this.recommendation,
    required this.isCritical,
  });
}
