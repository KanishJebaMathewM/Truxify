class DriverFatigueProfile {
  final String driverId;
  final double currentFatigueScore; // 0 (rested) to 100 (critical exhaustion)
  final int totalSleepMinutesLast24h;
  final String sleepQuality; // 'POOR', 'FAIR', 'GOOD', 'EXCELLENT'
  final int averageHeartRateBpm;
  final bool isLegallyAllowedToDrive; // HoS compliance
  final bool isPhysicallySafeToDrive; // Fatigue compliance

  DriverFatigueProfile({
    required this.driverId,
    required this.currentFatigueScore,
    required this.totalSleepMinutesLast24h,
    required this.sleepQuality,
    required this.averageHeartRateBpm,
    required this.isLegallyAllowedToDrive,
    required this.isPhysicallySafeToDrive,
  });
}
