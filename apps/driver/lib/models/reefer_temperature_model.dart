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

/// Live reefer temperature reading from the cold-chain IoT service (the
/// cold chain dashboard's model; distinct from the zone-level ReeferZone).
class ReeferTemperature {
  final String trailerId;
  final double currentTempCelsius;
  final double humidityPercentage;
  final double safeTempMin;
  final double safeTempMax;
  final DateTime timestamp;

  const ReeferTemperature({
    required this.trailerId,
    required this.currentTempCelsius,
    required this.humidityPercentage,
    required this.safeTempMin,
    required this.safeTempMax,
    required this.timestamp,
  });

  /// Whether the current temperature is outside the safe range.
  bool get isCritical =>
      currentTempCelsius < safeTempMin || currentTempCelsius > safeTempMax;
}
