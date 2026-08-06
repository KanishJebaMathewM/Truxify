class FatigueMetrics {
  final double eyeClosurePercentage; // 0.0 to 1.0
  final double blinkRatePerMinute;
  final int headNodsDetected;
  final bool isMicroSleepDetected;
  final String fatigueLevel; // 'Awake', 'Drowsy', 'Critical'
  final DateTime timestamp;

  FatigueMetrics({
    required this.eyeClosurePercentage,
    required this.blinkRatePerMinute,
    required this.headNodsDetected,
    required this.isMicroSleepDetected,
    required this.fatigueLevel,
    required this.timestamp,
  });
}
