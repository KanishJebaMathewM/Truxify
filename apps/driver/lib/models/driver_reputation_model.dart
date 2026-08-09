class DriverReputation {
  final String driverId;
  final double overallScore; // e.g. 0 to 100
  final double onTimePercentage;
  final double claimsRatio; // percentage of loads with damage claims
  final int hardBrakingEvents;
  final String tier; // e.g. 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE'

  DriverReputation({
    required this.driverId,
    required this.overallScore,
    required this.onTimePercentage,
    required this.claimsRatio,
    required this.hardBrakingEvents,
    required this.tier,
  });
}
