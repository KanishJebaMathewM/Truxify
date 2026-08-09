class ReeferZone {
  final String zoneId; // 'Zone 1 (Front)', 'Zone 2 (Rear)'
  final double currentTempF;
  final double targetTempF;
  final double ambientExternalTempF;
  final int compressorCycleCount;
  final bool doorsOpen;
  final double anomalyProbability; // 0.0 to 1.0
  final int estimatedMinutesToFailure;

  ReeferZone({
    required this.zoneId,
    required this.currentTempF,
    required this.targetTempF,
    required this.ambientExternalTempF,
    required this.compressorCycleCount,
    required this.doorsOpen,
    required this.anomalyProbability,
    required this.estimatedMinutesToFailure,
  });
}
