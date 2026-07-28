class ReeferTemperature {
  final String trailerId;
  final double currentTempCelsius;
  final double humidityPercentage;
  final double safeTempMin;
  final double safeTempMax;
  final DateTime timestamp;

  ReeferTemperature({
    required this.trailerId,
    required this.currentTempCelsius,
    required this.humidityPercentage,
    required this.safeTempMin,
    required this.safeTempMax,
    required this.timestamp,
  });

  bool get isCritical => currentTempCelsius < safeTempMin || currentTempCelsius > safeTempMax;
}
