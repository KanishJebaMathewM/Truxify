class BrakePadAnalytics {
  final String axlePosition; // e.g. 'Steer Axle', 'Drive Axle 1'
  final double estimatedRemainingLifePercent;
  final int estimatedRemainingMiles;
  final String wearSeverity; // 'Low', 'Moderate', 'High', 'Critical'
  final List<String> contributingFactors;

  BrakePadAnalytics({
    required this.axlePosition,
    required this.estimatedRemainingLifePercent,
    required this.estimatedRemainingMiles,
    required this.wearSeverity,
    required this.contributingFactors,
  });
}
